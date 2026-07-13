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
    GraphQLNonNull,
    GraphQLObjectType,
    GraphQLString,
} from 'graphql';
import { Dependency, GraphQLDependency } from '../src/index.js';
import { gqlType, hash, ResolveMethod } from '../src/helpers/index.js';

function makeType(name: string): GraphQLObjectType {
    return new GraphQLObjectType({
        name,
        fields: {
            id: { type: GraphQLInt },
            name: { type: GraphQLString },
        },
    });
}

describe('Dependency', () => {
    it('should be a function', () => {
        assert.equal(typeof Dependency, 'function');
    });

    it('should create a GraphQLDependency for a type', () => {
        const dep = Dependency(makeType('CreateOne'));

        assert.ok(dep instanceof GraphQLDependency);
    });

    it('should return the same dependency instance for the same type', () => {
        const type = makeType('MemoOne');

        assert.equal(Dependency(type), Dependency(type));
        assert.equal(Dependency(type), GraphQLDependency.create(type));
    });

    it('should return distinct dependencies for distinct types', () => {
        assert.notEqual(
            Dependency(makeType('DistinctA')),
            Dependency(makeType('DistinctB')),
        );
    });
});

describe('helpers', () => {
    describe('hash()', () => {
        const type = makeType('HashType');

        it('should return a 16-char hex signature', () => {
            assert.match(
                hash(type, ResolveMethod.LOADER, 1, 2),
                /^[0-9a-f]{16}$/,
            );
        });

        it('should be deterministic for identical inputs', () => {
            assert.equal(
                hash(type, ResolveMethod.LOADER, { a: 1 }),
                hash(type, ResolveMethod.LOADER, { a: 1 }),
            );
        });

        it('should differ by method and by arguments', () => {
            const base = hash(type, ResolveMethod.LOADER, 1);

            assert.notEqual(hash(type, ResolveMethod.INITIALIZER, 1), base);
            assert.notEqual(hash(type, ResolveMethod.LOADER, 2), base);
            assert.notEqual(
                hash(makeType('OtherHashType'), ResolveMethod.LOADER, 1),
                base,
            );
        });
    });

    describe('gqlType()', () => {
        const type = makeType('WrappedType');

        it('should return a plain object type unchanged', () => {
            assert.equal(gqlType({ type } as any), type);
        });

        it('should unwrap NonNull and List wrappers to the base type', () => {
            const wrapped = new GraphQLNonNull(new GraphQLList(type));

            assert.equal(gqlType({ type: wrapped } as any), type);
        });
    });
});
