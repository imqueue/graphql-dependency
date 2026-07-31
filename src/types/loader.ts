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
 * A bulk fetch for one entity type, registered with `defineLoader()` and called
 * whenever that type is needed as another type's dependency.
 *
 * @remarks
 * Every object returned must carry an `id`: results are keyed by it and attached
 * to their parents by it, and one without an `id` is silently unreachable.
 *
 * `filter` arrives with a *set* of values under each key rather than one value,
 * because a whole level of parent objects is fetched in a single call — so the
 * implementation has to treat every key as a list. Its shape is decided by the
 * `require()` calls that point at this type.
 *
 * @typeParam T - the entity type being loaded
 */
export type DataLoader<T> = (
    context: any,
    filter: any,
    fields?: any,
) => Promise<T[]>;
