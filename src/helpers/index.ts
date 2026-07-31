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
import { signature } from '../signature.js';
import { type GraphQLField, GraphQLList, GraphQLObjectType } from 'graphql';
import {
    type DependencyOptions,
    type DependencyOptionsGetter,
    type ResolutionCacheDataMap,
} from '../types/index.js';

/**
 * Which kind of call a cache signature identifies, so an initializer and a
 * loader for the same type and arguments never collide on one hash.
 */
export enum ResolveMethod {
    INITIALIZER,
    LOADER,
}

/**
 * Indexes objects by `id` into the request's data map for their type.
 *
 * @param source - one object or many; a falsy value leaves the map untouched
 * @param map - the map to fill
 * @returns the same map, extended
 */
export function makeCachedData(
    source: any,
    map: ResolutionCacheDataMap,
): ResolutionCacheDataMap {
    if (!source) {
        return map;
    }

    const src = Array.isArray(source) ? source : [source];

    for (const item of src) {
        map[item.id] = item;
    }

    return map;
}

/**
 * Builds the cache key for one initializer or loader call.
 *
 * @param entity - the type being resolved
 * @param method - which kind of call it is
 * @param args - the call arguments, folded into the hash
 * @returns a hex signature identifying this call
 */
export function hash(
    entity: GraphQLObjectType,
    method: ResolveMethod,
    ...args: any[]
): string {
    return signature(entity.name, method + '', args);
}

/**
 * Unwraps a field's type down to the object type underneath, so a
 * `[User!]!` field resolves to `User`.
 *
 * @remarks
 * Follows `ofType` until it runs out, which peels off any depth of `GraphQLList`
 * and `GraphQLNonNull` wrappers. Needed because a dependency is registered
 * against the bare object type while schema fields are usually wrapped.
 *
 * @param field - the field whose type to unwrap
 * @returns the object type at the centre of it
 */
export function gqlType(field: GraphQLField<any, any, any>): GraphQLObjectType {
    let type: any = field.type;
    let ofType: any;

    while ((ofType = type.ofType)) {
        type = ofType;
    }

    return type as GraphQLObjectType;
}

/**
 * Attaches loaded children to their parents, writing each match to the field the
 * requirement names.
 *
 * @remarks
 * Whether a parent gets a list or a single object comes from the target field's
 * own GraphQL type, not from how many matches there are — so a `GraphQLList`
 * field receives every match and a plain one receives the first. A parent with no
 * match is left alone rather than given an empty value, which keeps "not
 * requested" and "none found" distinguishable downstream.
 *
 * @param source - the parent objects
 * @param data - the loaded children, keyed by id
 * @param option - the requirement being satisfied
 * @returns `source`, mutated in place
 */
export function mapDependencyData(
    source: any,
    data: any,
    option: DependencyOptions,
) {
    const src = Array.isArray(source) ? source : [source];
    const to = option.as.name;
    const from = Object.keys(option.filter).map(dst => ({
        dst,
        src: option.filter[dst].name,
    }));
    const isList =
        option.as.type instanceof GraphQLList ||
        option.as.type.constructor.name === 'GraphQLList';

    for (const item of src) {
        if (isList) {
            const nodes = mapList(data, item, from);

            if (nodes) {
                item[to] = nodes;
            }
        } else {
            const node = mapItem(data, item, from);

            if (node) {
                item[to] = node;
            }
        }
    }

    return source;
}

/**
 * Collects every loaded object matching one parent, for a list-typed field.
 *
 * @param data - the loaded objects, keyed by id
 * @param item - the parent to match against
 * @param from - the field pairs to compare, child key to parent key
 * @returns the matching objects
 */
export function mapList(
    data: any,
    item: any,
    from: Array<{ dst: string; src: string }>,
): any[] {
    const filtered = Object.keys(data).filter(
        dataMatcher.bind(null, data, item, from),
    );

    return filtered.map(id => data[id]);
}

/**
 * Finds the first loaded object matching one parent, for a singular field.
 *
 * @param data - the loaded objects, keyed by id
 * @param item - the parent to match against
 * @param from - the field pairs to compare, child key to parent key
 * @returns the match, or `undefined` if there is none
 */
export function mapItem(
    data: any,
    item: any,
    from: Array<{ dst: string; src: string }>,
): any {
    const id = Object.keys(data).find(dataMatcher.bind(null, data, item, from));

    return id ? data[id] : undefined;
}

/**
 * Adds `id` to every level of a requested-fields map, since matching loaded
 * objects to their parents has nothing else to go on.
 *
 * @remarks
 * Mutates the map it is given rather than copying it — the caller's `fields`
 * object comes back changed. Where `id` was not requested it is added as `false`,
 * which asks the loader for the value without putting it in the response.
 *
 * @param fields - the requested-fields map to complete
 * @returns the same map
 */
export function ensureIds(fields: any) {
    if (!fields) {
        return fields;
    }

    if (typeof fields.id === 'undefined') {
        fields.id = false;
    }

    for (const prop of Object.keys(fields)) {
        if (fields[prop]) {
            ensureIds(fields[prop]);
        }
    }

    return fields;
}

/**
 * Tests whether one loaded object belongs to one parent, across every field pair
 * the requirement names.
 *
 * @remarks
 * All pairs must match. Comparison is deliberately non-strict: ids routinely
 * cross the service boundary as a number on one side and a string on the other,
 * and `1 === '1'` would break every such relation.
 *
 * @param data - the loaded objects, keyed by id
 * @param item - the parent to match against
 * @param from - the field pairs to compare, child key to parent key
 * @param id - which loaded object to test
 * @returns `true` when the object belongs to the parent
 */
export function dataMatcher(
    data: any,
    item: any,
    from: Array<{ dst: string; src: string }>,
    id: string | number,
): boolean {
    const node = data[id];

    for (const cfg of from) {
        // if a source of fetching contains list of values to match
        if (Array.isArray(item[cfg.src])) {
            if (!matchArray(item[cfg.src], cfg, node)) {
                return false;
            }
        } else {
            // note: we have a strong reason for non-strict
            // checking here, because of id number->string conversion
            // during mapping, so that is why we need to ignore linting
            // rule
            // tslint:disable-next-line
            if (node[cfg.dst] != item[cfg.src]) {
                return false;
            }
        }
    }

    return true;
}

/**
 * Matches a loaded object against a parent field holding several values, as a
 * list of foreign ids does.
 *
 * @remarks
 * Any one value matching is enough. Non-strict for the same reason as
 * {@link dataMatcher}: the two sides often disagree on whether an id is a number
 * or a string.
 *
 * @param items - the parent field's values
 * @param cfg - the field pair being compared
 * @param node - the loaded object to test
 * @returns `true` when any value matches
 */
export function matchArray(
    items: any[],
    cfg: { dst: string; src: string },
    node: any,
): boolean {
    for (const el of items) {
        // note: we have a strong reason for non-strict
        // checking here, because of id number->string conversion
        // during mapping, so that is why we need to ignore linting
        // rule
        // tslint:disable-next-line
        if (node[cfg.dst] == el) {
            return true;
        }
    }

    return false;
}

/**
 * Reports whether any of the given dependency requirements filters on a field
 * that the parent's initializer is responsible for filling — which is what
 * forces the initializer to finish before that dependency can be loaded.
 *
 * @remarks
 * This used to take the dependency and read the requirements off `this`,
 * declaring `this: any` so a caller could supply the parent with `.call()`. The
 * one caller did not, so every invocation threw on `this.options` and no
 * initializer could be used at all. The requirements are now an ordinary
 * parameter and there is nothing left to bind.
 *
 * @param initFieldNames - names of the fields the initializer fills
 * @param options - the parent's requirements for one dependency, as registered
 *                  by `require()`; getters are resolved here
 * @returns `true` when a requirement's filter reads an initializer field
 */
export function checkDepInit(
    initFieldNames: string[],
    options?: Array<DependencyOptions | DependencyOptionsGetter>,
): boolean {
    for (let option of options || []) {
        if (typeof option === 'function') {
            option = option();
        }

        for (const prop of Object.keys(option.filter)) {
            const filterPropName = option.filter[prop].name;

            if (~initFieldNames.indexOf(filterPropName)) {
                // this field is read by a dependency filter and is filled by
                // the initializer, so loading has to wait for it
                return true;
            }
        }
    }

    return false;
}
