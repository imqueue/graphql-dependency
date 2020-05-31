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
import { GraphQLObjectType } from 'graphql';

/**
 * Cached calls map structure
 */
export interface ResolutionCallsMap {
    [hash: string]: boolean;
}

/**
 * Cached resolution data map structure
 */
export interface ResolutionCacheDataMap {
    [id: string]: any;
}

/**
 * Cached resolution item
 */
export interface ResolutionCacheData {
    fields: any;
    data: ResolutionCacheDataMap;
    calls: ResolutionCallsMap;
}

/**
 * Map structure describing storage of cached data for a particular
 * graphql type
 */
export type ResolutionCache = Map<GraphQLObjectType, ResolutionCacheData>;
