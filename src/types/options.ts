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
import { type GraphQLField } from 'graphql';

/**
 * How a child type's objects are found: each key names a field of the child
 * loader's filter, and its value is the parent field supplying the values.
 *
 * @remarks
 * The direction catches people out, so read it as child-side key, parent-side
 * source. `{ [UserType.getFields().companyId.name]: CompanyType.getFields().id }`
 * says "call the user loader with `companyId` set to every company `id` in the
 * result set".
 *
 * The parent side is the `GraphQLField` object rather than its name, so a renamed
 * field cannot leave a stale string behind. Only `.name` is read from it.
 */
export interface DependencyFilterOptions {
    /**
     * The parent field whose values fill the child filter key named here.
     */
    [fieldName: string]: GraphQLField<any, any, any>;
}

/**
 * One relation between a parent type and a child type: where the loaded children
 * are attached, and how they are matched to their parent.
 */
export interface DependencyOptions {
    /**
     * The field on the parent type the loaded children are written to. Whether a
     * single object or a list is attached is taken from this field's own GraphQL
     * type, so a `GraphQLList` field receives every match and a plain one
     * receives the first.
     */
    as: GraphQLField<any, any, any>;

    /**
     * How to find the children belonging to each parent.
     */
    filter: DependencyFilterOptions;
}

/**
 * A relation supplied as a thunk, which is how `require()` takes it.
 *
 * @remarks
 * Deferred rather than eager because the types involved are usually still being
 * built when the relation is declared: a `GraphQLObjectType` with circular
 * references only has its fields once the schema settles, so `getFields()` has to
 * be called later than the `require()` that mentions it.
 */
export type DependencyOptionsGetter = () => DependencyOptions;

/**
 * A single field supplied as a thunk, used to name the fields an initializer
 * fills. Deferred for the same reason as {@link DependencyOptionsGetter}.
 */
export type DependencyFieldsGetter = () => GraphQLField<any, any, any>;
