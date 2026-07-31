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
import { GraphQLObjectType } from 'graphql';

/**
 * The loader and initializer calls already made during a request, keyed by a
 * hash of the call's signature.
 *
 * @remarks
 * This is what stops two requirements that reduce to the same lookup from
 * costing two round trips: the second finds the first one's entry and reuses it.
 * The hash covers the type, which of the two kinds of call it was, and the
 * arguments.
 *
 * The stored value is the call's own result — an id-keyed map of loaded objects
 * for a loader, or the initializer's result map. This was declared `boolean` in
 * earlier releases, which described the truthiness test at the read site rather
 * than what is actually kept.
 */
export interface ResolutionCallsMap {
    /**
     * The result of the call this hash identifies, reused instead of repeating
     * it.
     */
    [hash: string]: any;
}

/**
 * Every object of one type seen so far in a request, keyed by `id`.
 */
export interface ResolutionCacheDataMap {
    /**
     * The object carrying this `id`.
     */
    [id: string]: any;
}

/**
 * One type's entry in the resolution cache.
 */
export interface ResolutionCacheData {
    /**
     * The union of the fields every part of the request asked of this type.
     * Merging them means a type reached from several directions is fetched with
     * one field set wide enough for all of them, rather than once per caller.
     */
    fields: any;

    /**
     * The objects of this type already in hand, keyed by id. Ids found here are
     * dropped from a loader's filter, so nothing is fetched twice.
     */
    data: ResolutionCacheDataMap;

    /**
     * The calls already made for this type, so an identical one is not repeated.
     */
    calls: ResolutionCallsMap;
}

/**
 * Everything one `load()` call has resolved, one entry per participating type.
 *
 * @remarks
 * Created per request and discarded when `load()` returns — nothing is shared
 * between requests, so no request can be served another's stale data. It is
 * keyed by the `GraphQLObjectType` object itself, which is also how dependency
 * descriptions are registered.
 */
export type ResolutionCache = Map<GraphQLObjectType, ResolutionCacheData>;
