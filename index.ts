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
 * Declarative dependency loading for GraphQL schemas served by `@imqueue`
 * services — describe how your types relate once, at start-up, and nested data
 * arrives in bulk instead of one service call per resolved object.
 *
 * A GraphQL query spanning microservices normally degenerates into the N+1
 * problem: a field resolver runs once per parent object, and each run makes its
 * own RPC. This package takes the loading out of the field resolvers. Three
 * declarations per type, all made through {@link Dependency}, describe the
 * graph:
 *
 * - a **loader** ({@link GraphQLDependency.defineLoader}) — how to fetch many
 *   objects of one type at once, `(context, filter, fields) =\> Promise\<T[]\>`;
 * - **requirements** ({@link GraphQLDependency.require}) — which child types a
 *   type owns, the field each child attaches to, and which of the parent's own
 *   fields feed the child loader's filter;
 * - optionally an **initializer**, see
 *   {@link GraphQLDependency.defineInitializer} — an async routine that fills
 *   fields on the parent before its dependencies load, for when a dependency
 *   filter needs a value the initial result does not carry.
 *
 * Then one {@link GraphQLDependency.load} call in the top-level resolver walks
 * the fields the client actually asked for, merges everything that needs the
 * same type into a single filter, and calls each loader once per level.
 *
 * @remarks
 * Every object taking part must carry an `id`. Loaded rows are matched back
 * onto their parents by id and by nothing else, so `load()` adds `id` to the
 * requested-field map at every level — mutating the map it was handed.
 *
 * Work is batched per level, not globally. Sibling dependencies of one type run
 * concurrently; the next level down waits, because a child's filter is built
 * from values the parent level has just loaded. Within a level, an id already
 * present in the resolution cache is dropped from the filter, and two
 * requirements that produce the same filter share one loader call — which is
 * what keeps a query that reaches the same type from several directions down to
 * one round trip per distinct filter.
 *
 * The resolution cache lives for the duration of a single `load()` call and is
 * then discarded. Nothing is shared between requests, so no request can serve
 * another request's stale data.
 *
 * Registration, by contrast, is global and permanent: `Dependency(SomeType)`
 * always returns the same instance for the same `GraphQLObjectType`, so the
 * declarations belong next to the type definitions and run once at start-up.
 *
 * @example
 * ```typescript
 * import { Dependency } from '@imqueue/graphql-dependency';
 * import { fieldsMap } from 'graphql-fields-list';
 *
 * // at start-up, next to the type definitions
 * Dependency(UserType).defineLoader(async (context, filter, fields) =>
 *     (await context.user.listUser(filter, fields)).data,
 * );
 *
 * Dependency(CompanyType).require(UserType, () => ({
 *     as: CompanyType.getFields().employees,
 *     filter: {
 *         // UserType's loader filters by companyId; feed it every id in the
 *         // company result set
 *         [UserType.getFields().companyId.name]:
 *             CompanyType.getFields().id,
 *     },
 * }));
 *
 * // in the top-level company resolver
 * async function companies(source, args, context, info) {
 *     const data = await context.company.listCompany(args);
 *
 *     // one bulk call fills in employees for every company at once
 *     return Dependency(CompanyType).load(data, context, fieldsMap(info));
 * }
 * ```
 *
 * @packageDocumentation
 */
export * from './src/index.js';
