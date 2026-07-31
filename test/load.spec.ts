/*!
 * @imqueue/graphql-dependency - Declarative GraphQL dependency loading
 *
 * I'm Queue Software Project
 * Copyright (C) 2025  imqueue.com <support@imqueue.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * If you want to use this code in a closed source (commercial) project, you can
 * purchase a proprietary commercial license. Please contact us at
 * <support@imqueue.com> to get commercial licensing options.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    GraphQLInt,
    GraphQLList,
    GraphQLObjectType,
    GraphQLString,
} from 'graphql';
import { Dependency } from '../src/index.js';

// The registry is global and keyed by the type object, so every test builds its
// own pair of types rather than sharing one and inheriting the previous test's
// loader, initializer and requirements.
function makeTypes(suffix: string) {
    const Child: GraphQLObjectType = new GraphQLObjectType({
        name: `Child${suffix}`,
        fields: {
            id: { type: GraphQLInt },
            parentId: { type: GraphQLInt },
            title: { type: GraphQLString },
        },
    });

    const Parent: GraphQLObjectType = new GraphQLObjectType({
        name: `Parent${suffix}`,
        fields: {
            id: { type: GraphQLInt },
            name: { type: GraphQLString },
            tag: { type: GraphQLString },
            favouriteId: { type: GraphQLInt },
            children: { type: new GraphQLList(Child) },
            favourite: { type: Child },
        },
    });

    return { Parent, Child };
}

// Resolves after the pending microtasks and one macrotask turn, which is long
// enough for anything load() started to have got as far as its first await.
const settle = () => new Promise(resolve => setImmediate(resolve));

describe('GraphQLDependency#load()', () => {
    it('should return the source untouched when no fields are requested', async () => {
        const { Parent } = makeTypes('NoFields');
        const source = [{ id: 1 }];

        assert.equal(
            await Dependency(Parent).load(source, {}, undefined),
            source,
        );
    });

    it('should fetch a whole level of parents in one bulk call', async () => {
        const { Parent, Child } = makeTypes('List');
        const filters: any[] = [];

        Dependency(Child).defineLoader(async (_ctx: any, filter: any) => {
            filters.push(filter);

            return [
                { id: 1, parentId: 1, title: 'a' },
                { id: 2, parentId: 1, title: 'b' },
                { id: 3, parentId: 2, title: 'c' },
            ];
        });

        Dependency(Parent).require(Child, () => ({
            as: Parent.getFields().children,
            filter: { parentId: Parent.getFields().id },
        }));

        const source: any[] = [{ id: 1 }, { id: 2 }];

        await Dependency(Parent).load(
            source,
            {},
            { children: { title: false } },
        );

        assert.equal(filters.length, 1, 'one call for both parents');
        assert.deepEqual(filters[0], { parentId: [1, 2] });
        assert.deepEqual(
            source[0].children.map((c: any) => c.id),
            [1, 2],
        );
        assert.deepEqual(
            source[1].children.map((c: any) => c.id),
            [3],
        );
    });

    it('should attach a single object where the field is not a list', async () => {
        const { Parent, Child } = makeTypes('Single');

        Dependency(Child).defineLoader(async () => [
            { id: 7, title: 'chosen' },
        ]);

        Dependency(Parent).require(Child, () => ({
            as: Parent.getFields().favourite,
            filter: { id: Parent.getFields().favouriteId },
        }));

        const source: any[] = [{ id: 1, favouriteId: 7 }];

        await Dependency(Parent).load(
            source,
            {},
            { favourite: { title: false } },
        );

        assert.equal(source[0].favourite.title, 'chosen');
        assert.ok(
            !Array.isArray(source[0].favourite),
            'a non-list field gets the object itself',
        );
    });

    it('should add id to every level of the requested fields map', async () => {
        const { Parent, Child } = makeTypes('EnsureIds');

        Dependency(Child).defineLoader(async () => []);
        Dependency(Parent).require(Child, () => ({
            as: Parent.getFields().children,
            filter: { parentId: Parent.getFields().id },
        }));

        const fields: any = { children: { title: false } };

        await Dependency(Parent).load([{ id: 1 }], {}, fields);

        // matching is by id alone, so load() completes the map it was handed —
        // in place, which callers reusing the map need to know
        assert.equal(fields.id, false);
        assert.equal(fields.children.id, false);
    });

    it('should skip the loader when the filter has nothing left to look up', async () => {
        const { Parent, Child } = makeTypes('EmptyFilter');
        let calls = 0;

        Dependency(Child).defineLoader(async () => {
            calls++;

            return [];
        });

        Dependency(Parent).require(Child, () => ({
            as: Parent.getFields().children,
            filter: { parentId: Parent.getFields().id },
        }));

        // no parent carries the field the filter reads, so there is nothing to
        // ask for and the round trip is pointless
        await Dependency(Parent).load(
            [{ name: 'no id here' }],
            {},
            { children: { title: false } },
        );

        assert.equal(calls, 0);
    });
});

describe('GraphQLDependency#defineInitializer()', () => {
    it('should merge initializer data onto the source by id', async () => {
        const { Parent, Child } = makeTypes('InitMerge');

        Dependency(Child).defineLoader(async () => []);
        Dependency(Parent).require(Child, () => ({
            as: Parent.getFields().children,
            filter: { parentId: Parent.getFields().id },
        }));
        Dependency(Parent).defineInitializer(
            async () => ({ 1: { tag: 'first' }, 2: { tag: 'second' } }),
            () => Parent.getFields().tag,
        );

        const source: any[] = [{ id: 1 }, { id: 2 }, { id: 3 }];

        // Regression: this combination — an initializer plus a nested selection
        // — threw "Cannot read properties of undefined (reading 'options')" up
        // to 3.0.3, because waitForInit() called checkDepInit() without binding
        // the parent it read off `this`. Every documented use of an initializer
        // was therefore dead on arrival.
        await Dependency(Parent).load(
            source,
            {},
            { children: { title: false } },
        );

        assert.equal(source[0].tag, 'first');
        assert.equal(source[1].tag, 'second');
        assert.equal(source[2].tag, undefined, 'no entry, so left alone');
    });

    it('should leave source objects without an id untouched', async () => {
        const { Parent, Child } = makeTypes('InitNoId');

        Dependency(Child).defineLoader(async () => []);
        Dependency(Parent).require(Child, () => ({
            as: Parent.getFields().children,
            filter: { parentId: Parent.getFields().id },
        }));
        Dependency(Parent).defineInitializer(
            async () => ({ undefined: { tag: 'leaked' } }),
            () => Parent.getFields().tag,
        );

        const source: any[] = [{ name: 'anonymous' }];

        await Dependency(Parent).load(
            source,
            {},
            { children: { title: false } },
        );

        assert.equal(source[0].tag, undefined);
    });

    it('should block dependencies when no initializer fields are declared', async () => {
        const { Parent, Child } = makeTypes('InitBlocks');
        const order: string[] = [];
        let release!: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });

        Dependency(Child).defineLoader(async () => {
            order.push('loader');

            return [];
        });

        Dependency(Parent).require(Child, () => ({
            as: Parent.getFields().children,
            filter: { parentId: Parent.getFields().id },
        }));

        // no fields named, so there is no way to know which filters read one
        Dependency(Parent).defineInitializer(async () => {
            order.push('init:start');
            await gate;
            order.push('init:end');

            return {};
        });

        const loading = Dependency(Parent).load(
            [{ id: 1 }],
            {},
            { children: { title: false } },
        );

        await settle();

        assert.deepEqual(
            order,
            ['init:start'],
            'the loader must wait for an initializer of unknown reach',
        );

        release();
        await loading;

        assert.deepEqual(order, ['init:start', 'init:end', 'loader']);
    });

    it('should not block dependencies that read no initializer field', async () => {
        const { Parent, Child } = makeTypes('InitParallel');
        const order: string[] = [];
        let release!: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });

        Dependency(Child).defineLoader(async () => {
            order.push('loader');

            return [];
        });

        // the filter reads id; the initializer fills name — no overlap
        Dependency(Parent).require(Child, () => ({
            as: Parent.getFields().children,
            filter: { parentId: Parent.getFields().id },
        }));

        Dependency(Parent).defineInitializer(
            async () => {
                order.push('init:start');
                await gate;
                order.push('init:end');

                return {};
            },
            () => Parent.getFields().name,
        );

        const loading = Dependency(Parent).load(
            [{ id: 1 }],
            {},
            { children: { title: false } },
        );

        await settle();

        assert.deepEqual(
            order,
            ['init:start', 'loader'],
            'naming the initializer fields is what buys this parallelism',
        );

        release();
        await loading;
    });

    it('should block a dependency whose filter reads an initializer field', async () => {
        const { Parent, Child } = makeTypes('InitOverlap');
        const order: string[] = [];
        let release!: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });

        Dependency(Child).defineLoader(async () => {
            order.push('loader');

            return [];
        });

        // this time the filter reads the very field the initializer fills, so
        // loading before it finishes would filter on undefined
        Dependency(Parent).require(Child, () => ({
            as: Parent.getFields().children,
            filter: { parentId: Parent.getFields().tag },
        }));

        Dependency(Parent).defineInitializer(
            async () => {
                order.push('init:start');
                await gate;
                order.push('init:end');

                return { 1: { tag: 'ready' } };
            },
            () => Parent.getFields().tag,
        );

        const loading = Dependency(Parent).load(
            [{ id: 1 }],
            {},
            { children: { title: false } },
        );

        await settle();

        assert.deepEqual(order, ['init:start']);

        release();
        await loading;

        assert.deepEqual(order, ['init:start', 'init:end', 'loader']);
    });
});
