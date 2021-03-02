/*!
 * @imqueue/graphql-dependency - Declarative GraphQL dependency loading
 *
 * Copyright (c) 2019, imqueue.com <support@imqueue.com>
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
 * REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
 * AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
 * INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
 * LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
 * OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
 * PERFORMANCE OF THIS SOFTWARE.
 */
import { signature } from '@imqueue/rpc';
import {
    GraphQLField,
    GraphQLList,
    GraphQLObjectType,
} from 'graphql';
import { GraphQLDependency } from '../dependency';
import { DependencyOptions, ResolutionCacheDataMap } from '../types';

export enum ResolveMethod {
    INITIALIZER,
    LOADER,
}

/**
 * Builds cached data map from given source to given data map
 *
 * @access private
 * @param {any} source                 - data source
 * @param {ResolutionCacheDataMap} map - cached data map
 * @return {ResolutionCacheDataMap}
 */
export function makeCachedData(
    source: any,
    map: ResolutionCacheDataMap,
): ResolutionCacheDataMap {
    if (!source ) {
        return map;
    }

    const src = Array.isArray(source) ? source : [source];

    for (const item of src) {
        map[item.id] = item;
    }

    return map;
}

/**
 * Builds and returns call signature hash
 *
 * @access private
 * @param {GraphQLObjectType} entity - resolution entity type
 * @param {ResolveMethod} method     - resolution method
 * @param {...any[]} args            - call arguments
 * @return {string}
 */
export function hash(
    entity: GraphQLObjectType,
    method: ResolveMethod,
    ...args: any[]
): string {
    return signature(entity.name, method + '', args);
}

/**
 * Returns internal type of graphql field definition, so far it will return
 * proper type for lists, non nulls, etc...
 *
 * @param {GraphQLField<any, any, any>} field
 * @return {GraphQLObjectType}
 */
export function gqlType(
    field: GraphQLField<any, any, any>,
): GraphQLObjectType {
    let type: any = field.type;
    let ofType: any;

    while ((ofType = type.ofType)) {
        type = ofType;
    }

    return type as GraphQLObjectType;
}

/**
 * Maps dependency data to source object
 *
 * @access private
 * @param {any} source
 * @param {any} data
 * @param {DependencyOptions} option
 * @return {any}
 */
export function mapDependencyData(
    source: any,
    data: any,
    option: DependencyOptions,
) {
    const src = Array.isArray(source) ? source : [source];
    const to = option.as.name;
    const from = Object.keys(option.filter).map(dst => (
        { dst, src: option.filter[dst].name }
    ));
    const isList = option.as.type instanceof GraphQLList;

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
 * Maps an array of items from data matching given source item using given
 * from fields configuration.
 *
 * @access private
 * @param {any} data
 * @param {any} item
 * @param {{ dst: string, src: string }[]} from
 * @return {any[]}
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
 * Maps a single item from data to a given item using given from fields
 * configuration.
 *
 * @access private
 * @param {any} data
 * @param {any} item
 * @param {{ dst: string, src: string }[]} from
 * @return {any}
 */
export function mapItem(
    data: any,
    item: any,
    from: Array<{ dst: string; src: string }>,
): any {
    const id = Object.keys(data).find(
        dataMatcher.bind(null, data, item, from),
    );

    return id ? data[id] : undefined;
}

/**
 * Adds id field to all nested structures, to make sure we can always rely
 * our mapping on identifiers of fetched objects
 *
 * @access private
 * @param {any} fields
 * @return {any} - updated fields map object
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
 * Check if given item matches against elements in given data hash
 * using the given from fields configuration for a given data id key.
 *
 * @access private
 * @param {any} data
 * @param {any} item
 * @param {{ dst: string, src: string }[]} from
 * @param {string | number} id
 * @return {boolean}
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
 * Checks matching node against array of items
 *
 * @access private
 * @param {any[]} items
 * @param {{ dst: string, src: string }} cfg
 * @param {any} node
 * @return boolean
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
 * Checks if a given dep need wait for init
 * If certain statement can be calculated wil return exact boolean value,
 * otherwise will return undefined
 *
 * @access private
 * @param {string[]} initFieldNames
 * @param {GraphQLDependency<any>} dep
 * @return {boolean|undefined}
 */
export function checkDepInit(
    initFieldNames: string[],
    dep?: GraphQLDependency<any>,
): boolean | undefined {
    if (dep) {
        const options = this.options && this.options.get(dep);

        if (!options) {
            return false;
        }

        for (let option of options) {
            if (typeof option === 'function') {
                option = option();
            }

            for (const prop of Object.keys(option.filter)) {
                const filterPropName = option.filter[prop].name;

                if (~initFieldNames.indexOf(filterPropName)) {
                    // This a field required by dependency
                    // to load and this field is filled by initializer
                    return true;
                }
            }
        }
    }
}
