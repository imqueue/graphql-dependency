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
/**
 * What an initializer gives back: the extra fields to merge onto each object,
 * keyed by that object's `id`.
 *
 * @remarks
 * Each value is merged onto the matching object with `Object.assign`, so it
 * holds only the fields being added — not a replacement object. An id with no
 * matching object is ignored, and an object whose id is absent here is left
 * exactly as it was.
 */
export interface DataInitializerResult {
    /**
     * The fields to merge onto the object with this `id`.
     */
    [id: string]: any;
}

/**
 * An async routine that fills extra fields onto a type's own objects before its
 * dependencies load, registered with `defineInitializer()`.
 *
 * @remarks
 * Its job is to supply what a dependency filter needs but the initial result
 * does not carry — foreign ids that have to be fetched or derived first, for
 * instance. It is handed the resolver context, the objects loaded so far, and
 * the fields the request asked for, and returns a map keyed by object id.
 *
 * @typeParam T - the shape of the result set being initialized
 */
export type DataInitializer<T> = (
    context: any,
    result: T,
    fields?: any,
) => Promise<DataInitializerResult>;
