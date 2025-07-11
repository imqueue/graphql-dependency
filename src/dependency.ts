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
import { GraphQLField, GraphQLObjectType } from 'graphql';
import {
    checkDepInit,
    ensureIds,
    gqlType,
    hash,
    makeCachedData,
    mapDependencyData,
    ResolveMethod,
} from './helpers';
import {
    DataInitializer,
    DataLoader,
    DependencyFieldsGetter,
    DependencyFilterOptions,
    DependencyOptions,
    DependencyOptionsGetter,
    ResolutionCache,
    ResolutionCacheData,
} from './types';

/**
 * Class GraphQLDependency
 * Implements dependency relationship descriptions between different
 * GraphQLObjectType entities, providing possibility of optimal data
 * fetching during GraphQL queries resolution.
 *
 * Glossary:
 * - Initializer: async routine required to fill up
 *   specific entity set. Can block deps loading
 *   before resolution if init fields are a part of
 *   dep loading process
 * - Loader: async routine required to load dependency
 *   itself by a given filter using a given request
 *   fields.
 *
 * It implements cascade loading - analyze request fields against
 * initial result and build load chains for the same type
 * with merging all fields for the same type and load
 * only missing objects on each iteration. Loading are performed
 * as bulk operations using defined bulk data-loaders and initializers.
 * It will try to perform as parallel as possible depending on the dependencies
 * definition between objects.
 */
export class GraphQLDependency<ResultType> {

    /**
     * Creates dependency entity registering it with internal registry
     * for further use. Use this method to construct entities as far as
     * it will guarantee there is only one instance created for particular
     * GraphQL object type, which it wraps on app initialization.
     *
     * @param {GraphQLObjectType} type
     * @return {GraphQLDependency<TResultType>}
     */
    public static create<TResultType>(
        type: GraphQLObjectType,
    ): GraphQLDependency<TResultType> {
        let dep = GraphQLDependency.deps.get(type);

        if (!dep) {
            dep = new GraphQLDependency<TResultType>(type);
            GraphQLDependency.deps.set(type, dep);
        }

        return dep;
    }

    /**
     * Checks if a given filter arg is empty or not
     *
     * @access private
     * @param {any} filter
     * @return {boolean}
     */
    public static isEmptyArg(filter: any): boolean {
        if (Array.isArray(filter) && filter.length) {
            return false;
        }

        if (filter && typeof filter === 'object') {
            for (const prop of Object.keys(filter)) {
                if (Array.isArray(filter[prop])) {
                    if (filter[prop].length) {
                        return false;
                    }
                } else if (filter[prop]) {
                    return false;
                }
            }

            return true;
        }

        return !filter;
    }

    private static deps = new Map<GraphQLObjectType, GraphQLDependency<any>>();

    private loader: DataLoader<any>;
    private init?: DataInitializer<any>;
    private initFields: DependencyFieldsGetter[];
    private options = new Map<
        GraphQLDependency<any>,
        Array<DependencyOptions | DependencyOptionsGetter>
    >();
    private initFieldNames: string[] = [];

    /**
     * Class constructor
     * @constructor
     * @param {GraphQLObjectType} type - associated GraphQL type
     */
    protected constructor(public readonly type: GraphQLObjectType) { }

    // noinspection JSUnusedGlobalSymbols
    /**
     * Defines a loader for this particular dependency. This
     * usually must be a bulk loading function accepting input of
     * filters and returning appropriate data result type.
     *
     * Usually this can be defined close to the entity definition itself
     * and signal that the entity may be a part of dependent structure for
     * other top-level entities in the queries.
     *
     * @example
     * ```typescript
     * Dependency(User).defineLoader(async <User[]>(
     *   context: any,
     *   filter: FiltersInput,
     *   fields?: FieldsMapInput,
     * ) => (await context.user.listUser(filter, fields)).data);
     * ```
     *
     * @param {DataLoader<T>} loader
     * @return {GraphQLDependency}
     */
    public defineLoader<T>(
        loader: DataLoader<T>,
    ): GraphQLDependency<ResultType> {
        this.loader = loader;

        return this;
    }

    // noinspection JSUnusedGlobalSymbols
    /**
     * Defines an async initializer for this particular entity. Initializers are
     * usually used to perform async routines required to pre-fill entity
     * data before any other dependencies for this entity are loaded.
     *
     * Note: ite performs better when initializer fields are provided.
     *
     * @example
     * ```typescript
     * Dependency(UserType).defineInitializer(
     *   async <User[]>(
     *     context: any,
     *     result: User[],
     *   ) => {
     *     // do init stuff appending extra fields to
     *     // result set...
     *     // this will block deps loading related to
     *     // initializer fields or will block all deps loading
     *     // if initializer fields are not specified
     *   },
     *   User.getFields().orderId,
     *   User.getFields().shipmentIds,
     * );
     * ```
     *
     * @param {DataInitializer} initializer - async init routine to be used as
     *                                        entity initializer
     * @param {...GraphQLField} [fields]    - list of initializer fields it is
     *                                        linked to [optional].
     * @return {GraphQLDependency}
     */
    public defineInitializer(
        initializer: DataInitializer<ResultType>,
        ...fields: DependencyFieldsGetter[]
    ): GraphQLDependency<ResultType> {
        this.init = initializer;
        this.initFields = fields;

        return this;
    }

    // noinspection JSUnusedGlobalSymbols
    /**
     * Defines dependencies for this entity.
     * Usually it lays along with the entity definition itself and describes
     * how the particular entity should be fully resolved.
     *
     * @example
     * ```typescript
     * Dependency(CompanyType).require(UserType, () => ({
     *   as: CompanyType.getFields().employees
     *   filter: { [User.getFields().companyId.name]: Company.getFields().id }
     * }), () => ({
     *   as: Company.getFields().owner,
     *   filter: { [UserType.getFields().id.name]: Company.getFields().ownerId }
     * }));
     * ```
     *
     * @param {GraphQLObjectType} child - child entity this entity depends on
     * @param {DependencyOptions} options - options for dependency description
     * @return {GraphQLDependency}
     */
    public require(
        child: GraphQLObjectType,
        ...options: DependencyOptionsGetter[]
    ): GraphQLDependency<ResultType> {
        this.options.set(Dependency(child), options);

        return this;
    }

    // noinspection JSUnusedGlobalSymbols
    /**
     * Performs actual work on loading all entities current entity depends on.
     * This will load all dependent entities using pre-defined bulk loaders
     * and dependency configurations which were set by defineInitializer(),
     * defineLoader() and require() calls on app startup. Loading is usually
     * performed at runtime on particular graphql queries.
     *
     * During the execution it will analyze and call those bulk loaders
     * which are required to pre-fill user data with related dependent
     * structures. If some loaders may be need to called several times it
     * will request only missing parts, those which was already pre-loaded
     * would be re-used from previous load calls.
     *
     * Finally, this will be processed as:
     *   1. Scan fields to identify which deps loaders requested to call
     *   2. Scan deps and underlying types across fields and merge all
     *      similar-type request fields into minimal complete fields map
     *      definition
     *   3. Scan and call for proper initializers and deps loaders in
     *      particular order
     *   4. Re-map loaded data to result according requested by user fields
     *   5. Return modified result
     *
     * @example
     * ```typescript
     * async buildResolutionCache(
     *   source: any,
     *   args: any,
     *   context: any,
     *   info: GraphQLResolveInfo,
     * ) => { // imagine we are inside some query resolver
     *   const fields = fieldsMap(info);
     *   const userData = await context.userService.listAll();
     *
     *   return await Dependency(User).load(userData, context, fields);
     * }
     * ```
     *
     * @param {any} source  - source data object, usually obtained by some
     *                        initial service call inside particular query
     *                        resolver
     * @param {any} context - execution context (usually passed to graphql
     *                        resolver)
     * @param {any} fields  - requested fields as map object (usually can be
     *                        obtained from GraphQLResolveInfo object passed
     *                        to a query resolver and constructed using
     *                        graphql-fields-map#fieldsMap() routine)
     * @return {Promise<any>}
     */
    public async load(
        source: ResultType,
        context: any,
        fields: any,
    ): Promise<ResultType> {
        if (!fields) {
            // nothing to do, as long as load fields are not specified
            return source;
        }

        this.initFieldNames = (this.initFields || [])
            .map(field => field().name);

        ensureIds(fields);

        const cache = this.buildResolutionCache(fields, source);

        return await this.incrementalLoad(source, context, fields, cache);
    }

    /**
     * Resolves dependencies required to be loaded for a given user request
     * identified by given request fields. Stores resolution result
     * under given result map or will initializes new one and returns it.
     * Result map usually is used by a recursive calls, so should not be passed
     * on a top-level dependency call.
     *
     * @access private
     * @param {any} fields              - user requested fields
     * @param {any} [source]            - cached data if any
     * @param {ResolutionCache} [cache] - resolution map to store result in
     * @return {ResolutionCache}        - resolution map and max call priority
     */
    private buildResolutionCache(
        fields: any,
        source?: ResultType,
        cache: ResolutionCache = new Map(),
    ): ResolutionCache {
        const graphqlFields = this.type.getFields();

        if (source) {
            const cacheData = cache.get(this.type) || {} as ResolutionCacheData;

            cacheData.fields = Object.assign(cacheData.fields || {}, fields);
            cacheData.data = makeCachedData(
                source, cacheData.data || {});
            cacheData.calls = {};

            cache.set(this.type, cacheData);
        }

        for (const field of Object.keys(fields)) {
            if (!(fields[field] && graphqlFields[field])) {
                // we are skipping scalars or non-nested deps
                // as deps only nested objects always
                continue;
            }

            const type = gqlType(graphqlFields[field]);
            const dep = GraphQLDependency.deps.get(type);

            if (dep) {
                const cacheData = cache.get(type) || {} as ResolutionCacheData;
                const src = this.childSource(source as any, field);

                cacheData.fields = Object.assign(
                    cacheData.fields || {},
                    fields[field],
                );
                cacheData.data = makeCachedData(
                    src, cacheData.data || {});
                cacheData.calls = {};

                cache.set(type, cacheData);

                // this field is a part of our dependency
                dep.buildResolutionCache(fields[field], src, cache);
            }
        }

        return cache;
    }

    /**
     * Collects and returns call arguments for dependency loader from a given
     * source data using dependency filtering argument options
     *
     * @access private
     * @param {any} source                     - data source object
     * @param {DependencyFilterOptions} filter - filter arguments lookup opts
     * @param {ResolutionCache} cache          - resolution cache
     * @return {any}                           - call filtering argument
     */
    private makeCallArgs(
        source: ResultType,
        filter: DependencyFilterOptions,
        cache: ResolutionCacheData,
    ): any {
        if (!source) {
            throw new TypeError(
                'Broken call chain, source expected to be value!',
            );
        }

        const arg: any = {};
        const src: any[] = Array.isArray(source) ? source : [source];

        for (const prop of Object.keys(filter)) {
            arg[prop] = [...new Set(src.reduce((res, item) => {
                res.push(...(
                    Array.isArray(item[filter[prop].name])
                        ? item[filter[prop].name]
                        : [item[filter[prop].name]]
                ) as any[]);

                return res;
            }, []))].filter(val => !!val);

            // for id filters - check against cached data to not load
            // anything being already loaded
            if (prop === 'id') {
                arg[prop] = arg[prop].filter((id: any) =>
                    !(cache && cache.data && cache.data[id]));
            }
        }

        return arg;
    }

    /**
     * Performs recursive incremental load of dependent data and map results to
     * a given source object then returns it
     *
     * @access private
     * @param {any} source
     * @param {any} context
     * @param {any} fields
     * @param {ResolutionCache} cache
     * @return {any}
     */
    private async incrementalLoad(
        source: ResultType,
        context: any,
        fields: any,
        cache: ResolutionCache,
    ): Promise<ResultType> {
        if (!source) {
            return source;
        }

        let promises: Array<Promise<any>> = [];
        const gqlFields = this.type.getFields();
        const children: Array<{
            field: string,
            dep: GraphQLDependency<any>,
        }> = [];

        if (this.init) {
            if (this.waitForInit(fields, gqlFields)) {
                await this.requestInitializer(source, context, fields, cache);
            } else {
                promises.push(this.requestInitializer(
                    source, context, fields, cache,
                ));
            }
        }

        for (const field of Object.keys(fields)) {
            if (!(fields[field] && gqlFields[field])) {
                // we are skipping scalars or non-nested deps
                // as deps only nested objects always
                continue;
            }

            const type = gqlType(gqlFields[field]);
            const dep = GraphQLDependency.deps.get(type);

            if (dep) {
                children.push({ field, dep });

                if (!dep.loader) {
                    continue;
                }

                const options = this.options.get(dep) || [];

                for (let option of options) {
                    if (typeof option === 'function') {
                        option = option();
                    }

                    promises.push(this.requestLoader(
                        source, context, option, dep, cache,
                    ));
                }
            }
        }

        if (promises.length) {
            // this level dependencies
            await Promise.all(promises);
        }

        // children recursive load
        if (children && children.length) {
            promises = [];

            for (const child of children) {
                if (!fields[child.field]) {
                    continue;
                }

                const src = this.childSource(source, child.field);

                promises.push(child.dep.incrementalLoad(
                    src, context, fields[child.field], cache,
                ));
            }

            if (promises.length) {
                // next level dependencies as recursive call
                await Promise.all(promises);
            }
        }

        return source;
    }

    /**
     * Builds and returns next callable level of source object for child
     * dependencies
     *
     * @access private
     * @param {any} source
     * @param {string} field
     * @return {any[]}
     */
    private childSource(source: ResultType, field: string): any[] {
        if (!source) {
            return [];
        }

        const src = Array.isArray(source) ? source : [source];

        if (!field) {
            return src;
        }

        const childSource: any[] = [];

        for (const item of src) {
            if (item[field]) {
                // we may have list, object or scalar in data under the given
                // field, so we have to take it into account as far as we
                // expect plain list of objects to be returned
                if (Array.isArray(item[field])) {
                    childSource.push(...item[field]);
                } else {
                    childSource.push(item[field]);
                }
            }
        }

        return childSource;
    }

    /**
     * Checks if given user requested fields need to be initialized before
     * any dependency for current load level to be called (this usually
     * occurs when dependency relies on initializer dependent fields)
     *
     * @access private
     * @param {any} fields
     * @param {GraphQLFieldMap<any, any, any>>} [gqlFields]
     * @return {boolean}
     */
    private waitForInit(
        fields: any,
        gqlFields = this.type.getFields(),
    ): boolean {
        if (!this.init) {
            // there is no initializer defined, so nothing to wait for
            return false;
        }

        if (!this.initFields) {
            // we do not know if some fields which are filled by
            // initializer are required by some deps, so - we will wait
            // to be safe
            return true;
        }

        for (const field of Object.keys(fields)) {
            if (!(fields[field] && gqlFields[field])) {
                continue;
            }

            const found = checkDepInit(
                this.initFieldNames,
                GraphQLDependency.deps.get(gqlType(gqlFields[field])),
            );

            if (typeof found !== 'undefined') {
                return found;
            }
        }

        return false;
    }

    /**
     * Performs initializer call and maps it's result to a given data source,
     * returning modified source object.
     *
     * @access private
     * @param {any} source            - data source object
     * @param {any} context           - GraphQL request context
     * @param {any} fields            - user request fields map
     * @param {ResolutionCache} cache - request resolution cache
     * @return {any}
     */
    private async requestInitializer(
        source: ResultType,
        context: any,
        fields: any,
        cache: ResolutionCache,
    ) {
        const key = hash(
            this.type, ResolveMethod.INITIALIZER, fields,
        );
        const thisCache = cache.get(this.type);
        let initData: any;

        if (thisCache && thisCache.calls[key]) {
            initData = thisCache.calls[key];
        } else if (this.init) {
            initData = await this.init(context, source, fields);

            if (thisCache) {
                thisCache.calls[key] = initData;
            }
        }

        if (!initData) {
            return source;
        }

        const src = Array.isArray(source) ? source : [source];

        for (const item of src) {
            if (!(item && item.id)) {
                continue;
            }

            Object.assign(item, initData[item.id]);
        }

        return source;
    }

    /**
     * Performs recursive dependency loading and updates source object
     * with loaded data
     *
     * @access private
     * @param {any} source                 - data source object
     * @param {any} context                - graphql request context object
     * @param {DependencyOptions} option   - dependency options config
     * @param {GraphQLDependency<any>} dep - loaded dependency object itself
     * @param {ResolutionCache} cache      - Resolution cache object
     * @return {any}
     */
    private async requestLoader(
        source: ResultType,
        context: any,
        option: DependencyOptions,
        dep: GraphQLDependency<any>,
        cache: ResolutionCache,
    ) {
        const depCache = cache.get(dep.type);

        if (!depCache) {
            return source;
        }

        const filter = this.makeCallArgs(source, option.filter, depCache);

        if (GraphQLDependency.isEmptyArg(filter)) {
            // nothing to load, so just make sure we can map existing
            // data from the resolution cache
            return mapDependencyData(
                source, depCache.data, option,
            );
        }

        const key = hash(
            dep.type, ResolveMethod.LOADER, filter,
        );

        if (!(depCache && depCache.calls[key])) {
            const data = (await dep.loader(context, filter, depCache.fields))
                .reduce((res, next) => {
                    res[next.id] = next;

                    return res;
                }, {});

            depCache.calls[key] = data;
            Object.assign(depCache.data, data);
        }

        return mapDependencyData(
            source, depCache.data, option,
        );
    }
}

/**
 * Imitates static constructor for GraphQLDependency class. Actually it is
 * a short-hand alias to GraphQLDependency.create
 *
 * @see GraphQLDependency#create
 *
 * @example
 * ```typescript
 * Dependency(UserType).require(CompanyType, {
 *   as: UserType.getFields().company,
 *   filter: { // filter is used for company data loader
 *     [CompanyType.getFields().id.name]: UserType.getFields().companyId,
 *   },
 * });
 * ```
 *
 * @param {GraphQLObjectType}
 * @return {GraphQLDependency}
 */
export const Dependency = GraphQLDependency.create;
