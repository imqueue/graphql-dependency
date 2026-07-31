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
import {
    checkDepInit,
    ensureIds,
    gqlType,
    hash,
    makeCachedData,
    mapDependencyData,
    ResolveMethod,
} from './helpers/index.js';
import {
    type DataInitializer,
    type DataLoader,
    type DependencyFieldsGetter,
    type DependencyFilterOptions,
    type DependencyOptions,
    type DependencyOptionsGetter,
    type ResolutionCache,
    type ResolutionCacheData,
} from './types/index.js';

/**
 * One GraphQL object type's place in the dependency graph — its bulk loader,
 * its optional initializer, and the child types it owns.
 *
 * @remarks
 * Descriptions are registered one per `GraphQLObjectType` and are never
 * constructed directly: the constructor is `protected`, and {@link Dependency}
 * (or {@link GraphQLDependency.create}, which it aliases) hands back the single
 * description belonging to a type, creating it on first use. Two calls for the
 * same type always return the same object, which is what lets the loader, the
 * initializer and the requirements each be declared wherever is most natural —
 * usually beside the type definition — and still add up to one description.
 *
 * Three declarations build it up, all of them start-up work, and each returns
 * `this` so they chain:
 *
 * - {@link GraphQLDependency.defineLoader} — how to fetch this type in bulk;
 * - {@link GraphQLDependency.require} — the child types this one owns;
 * - {@link GraphQLDependency.defineInitializer} — optional pre-fill for fields
 *   the dependency filters need but the initial result does not carry.
 *
 * {@link GraphQLDependency.load} is the runtime half, called once per request
 * from a top-level resolver.
 *
 * Resolution cascades rather than running per field. `load()` walks the
 * requested field map, merges every request for the same type into a single
 * field set, and calls the bulk loaders level by level — concurrently within a
 * level — asking each for only the objects the request has not already fetched.
 * Results are attached to the parents by id and by reference rather than copied,
 * so a query reaching the same type from several directions costs one round trip
 * per distinct filter instead of one per object.
 */
export class GraphQLDependency<ResultType> {
    /**
     * Returns the dependency description for a GraphQL object type, creating
     * and registering it the first time the type is seen.
     *
     * @remarks
     * Use this, or the shorter {@link Dependency} alias, rather than `new` — the
     * constructor is `protected` to make that the only option. The registry is
     * global to the process and keyed by the `GraphQLObjectType` object itself,
     * so any module asking about a type gets the same description, and two
     * separately built types of the same name are two separate entries.
     *
     * @param type - the GraphQL object type to describe
     * @returns the one description registered against `type`
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
     * Reports whether a filter assembled for a loader has nothing left to look
     * up, so the loader can be skipped.
     *
     * @remarks
     * This is the test that keeps a query from making pointless round trips:
     * once the ids already in the request's resolution cache have been removed
     * from a filter, what remains may be nothing at all, and the dependency is
     * then satisfied from the cache instead of by a call.
     *
     * "Empty" is looser than falsy, and worth knowing precisely if you write
     * your own filters. An array is empty when it has no elements. A plain
     * object is empty when every one of its own properties is either falsy or an
     * empty array — so `{}` and `{ ids: [] }` both count as empty, while
     * `{ ids: [1] }` does not. Anything else is empty when it is falsy.
     *
     * @param filter - the filter value to test
     * @returns `true` when there is nothing left to fetch
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

    private loader!: DataLoader<any>;
    private init?: DataInitializer<any>;
    private initFields!: DependencyFieldsGetter[];
    private options = new Map<
        GraphQLDependency<any>,
        Array<DependencyOptions | DependencyOptionsGetter>
    >();

    /**
     * Registers a description against its type. Not called directly — the
     * constructor is `protected` so that {@link Dependency} and
     * {@link GraphQLDependency.create} stay the only way in, which is what
     * keeps one description per type.
     *
     * @param type - the GraphQL object type being described
     */
    protected constructor(
        /**
         * The GraphQL object type this description belongs to. Readable because
         * both the registry and the per-request resolution cache are keyed by
         * the type object itself, so anything walking the graph needs it.
         */
        public readonly type: GraphQLObjectType,
    ) {}

    // noinspection JSUnusedGlobalSymbols
    /**
     * Declares how to fetch many objects of this type in one call, which is
     * what makes the type usable as another type's dependency.
     *
     * @remarks
     * The loader receives a filter assembled from the parent objects — its shape
     * is whatever {@link GraphQLDependency.require} maps into it — together with
     * the merged set of fields the query asked for, so both can be pushed down
     * to the service or store behind it.
     *
     * Two things are required of it. Every object it returns must carry an `id`,
     * because results are keyed by id and attached to parents by id. And it must
     * accept a *set* of values per filter key rather than one, since fetching a
     * whole level of parents in a single call is the entire point.
     *
     * Declaring a loader is also what makes a type eligible to be `require()`d
     * elsewhere. A type with requirements but no loader is not an error: no call
     * is made for it, and its own children are still resolved against whatever
     * data the parent result already holds.
     *
     * @example
     * ```typescript
     * Dependency(UserType).defineLoader(async (
     *     context: any,
     *     filter: FiltersInput,
     *     fields?: FieldsMapInput,
     * ) => (await context.user.listUser(filter, fields)).data);
     * ```
     *
     * @param loader - bulk fetch for this type
     * @returns this description, so calls can be chained
     */
    public defineLoader<T>(
        loader: DataLoader<T>,
    ): GraphQLDependency<ResultType> {
        this.loader = loader;

        return this;
    }

    // noinspection JSUnusedGlobalSymbols
    /**
     * Declares an async routine that fills extra fields onto this type's own
     * objects before its dependencies are loaded.
     *
     * @remarks
     * Reach for it when a dependency's filter needs a value the initial result
     * does not carry — a list of foreign ids that has to be fetched or derived
     * first, typically. The initializer returns a map keyed by object id, and
     * each entry is merged onto the matching object with `Object.assign`; source
     * objects without an `id` are skipped.
     *
     * Naming the fields it fills is optional but worth doing. Given them,
     * loading only waits for the initializer when some dependency's filter
     * actually reads one of those fields, and everything else starts alongside
     * it. Leave them out and there is no way to tell, so every dependency at
     * this level waits — correct, but serialised.
     *
     * @example
     * ```typescript
     * Dependency(UserType).defineInitializer(
     *     async (context: any, result: User[]) => {
     *         const ids = result.map(user => user.id);
     *         const orders = await context.order.listByUser(ids);
     *
     *         // keyed by user id; merged onto the matching user, so the
     *         // orderId filter below has a value to work from
     *         return orders;
     *     },
     *     () => UserType.getFields().orderId,
     *     () => UserType.getFields().shipmentIds,
     * );
     * ```
     *
     * @param initializer - async routine returning a map of object id to the
     *                      extra fields to merge onto that object
     * @param fields - accessors for the fields the initializer fills; supply
     *                 them so dependencies that do not read them need not wait
     * @returns this description, so calls can be chained
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
     * Declares that this type owns a child type, and how the child's objects are
     * found and where they are attached.
     *
     * @remarks
     * Each requirement is a pair. `as` is the field on *this* type the loaded
     * children are written to — whether one child or a list is attached is
     * decided by that field's own GraphQL type. `filter` maps a key of the
     * child's loader filter to the field on *this* type whose values fill it, so
     * it reads child-side key first, parent-side source second.
     *
     * Passing several requirements for one child type is the normal case rather
     * than a special one: a company relating to users as both `owner` and
     * `employees` is two requirements naming `UserType`, differing in `as` and
     * in which field feeds the filter.
     *
     * Requirements are given as thunks because the types they reference are
     * usually still being defined when this runs — a `GraphQLObjectType` with
     * circular references only has its fields once the schema settles, so the
     * getters are called at request time, not now.
     *
     * A repeat call for the same child type replaces that type's requirements
     * rather than adding to them; list every relation to a type in one call.
     *
     * @example
     * ```typescript
     * Dependency(CompanyType).require(
     *     UserType,
     *     () => ({
     *         as: CompanyType.getFields().employees,
     *         filter: {
     *             [UserType.getFields().companyId.name]:
     *                 CompanyType.getFields().id,
     *         },
     *     }),
     *     () => ({
     *         as: CompanyType.getFields().owner,
     *         filter: {
     *             [UserType.getFields().id.name]:
     *                 CompanyType.getFields().ownerId,
     *         },
     *     }),
     * );
     * ```
     *
     * @param child - the child type this type depends on
     * @param options - one getter per relation to `child`
     * @returns this description, so calls can be chained
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
     * Loads everything the request asked for beneath this type and attaches it
     * to the result, in as few bulk calls as the graph allows.
     *
     * @remarks
     * This is the one runtime call. Everything else on this class is start-up
     * declaration; here those declarations meet an actual query. Invoke it from
     * a top-level resolver, after the initial service call, and hand it the
     * fields the client asked for.
     *
     * What it does, in order: scan the requested fields for types that have a
     * dependency description; merge every request for the same type into one
     * minimal field set; run the initializers and bulk loaders in dependency
     * order, level by level and concurrently within a level; attach each loaded
     * object to its parents; and return the result.
     *
     * Two things to be aware of, both of which follow from matching by id.
     * `fields` is mutated: `id` is added at every level of the map, since
     * without it nothing can be attached. And `source` is mutated too — the
     * dependency fields are written onto the very objects that were passed in,
     * and the return value is that same object rather than a copy. Loaded
     * children are shared by reference between the parents that match them, so a
     * result graph stays cheap even when many parents point at the same child.
     *
     * A falsy `fields` short-circuits: nothing is requested, so `source` comes
     * back untouched. `source` may be a single object or an array of them.
     *
     * @example
     * ```typescript
     * async function user(
     *     source: any,
     *     args: any,
     *     context: any,
     *     info: GraphQLResolveInfo,
     * ) {
     *     const fields = fieldsMap(info);
     *     const data = await context.user.listUser(args);
     *
     *     // fills in every dependent structure the query touched
     *     return Dependency(UserType).load(data, context, fields);
     * }
     * ```
     *
     * @param source - the objects already fetched by the resolver, one or many
     * @param context - the GraphQL resolver context, handed to every loader and
     *                  initializer untouched
     * @param fields - the requested fields as a nested map, as produced by
     *                 `fieldsMap()` from `graphql-fields-list` over the
     *                 resolver's `GraphQLResolveInfo`
     * @returns `source`, with the requested dependencies attached
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

        ensureIds(fields);

        const cache = this.buildResolutionCache(fields, source);

        return await this.incrementalLoad(source, context, fields, cache);
    }

    /**
     * Walks the requested fields and builds the cache the whole request will
     * resolve against — one entry per participating type, holding the merged
     * field set and whatever objects are already in hand.
     *
     * @remarks
     * Recursive: `cache` accumulates across the descent, so callers outside this
     * class leave it out and get a fresh map.
     *
     * @param fields - the fields requested at this level
     * @param source - objects already available at this level, if any
     * @param cache - the map being filled, for recursive calls
     * @returns the resolution cache, keyed by GraphQL type
     */
    private buildResolutionCache(
        fields: any,
        source?: ResultType,
        cache: ResolutionCache = new Map(),
    ): ResolutionCache {
        const graphqlFields = this.type.getFields();

        if (source) {
            const cacheData =
                cache.get(this.type) || ({} as ResolutionCacheData);

            cacheData.fields = Object.assign(cacheData.fields || {}, fields);
            cacheData.data = makeCachedData(source, cacheData.data || {});
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
                const cacheData =
                    cache.get(type) || ({} as ResolutionCacheData);
                const src = this.childSource(source as any, field);

                cacheData.fields = Object.assign(
                    cacheData.fields || {},
                    fields[field],
                );
                cacheData.data = makeCachedData(src, cacheData.data || {});
                cacheData.calls = {};

                cache.set(type, cacheData);

                // this field is a part of our dependency
                dep.buildResolutionCache(fields[field], src, cache);
            }
        }

        return cache;
    }

    /**
     * Builds one dependency loader's filter by collecting, across every object
     * at this level, the values of the parent fields the requirement points at.
     *
     * @remarks
     * Values are de-duplicated and falsy ones dropped, so a level of parents
     * becomes one filter with one set of values per key. An `id` key gets a
     * second pass: ids already in the cache are removed, which is what makes a
     * repeat visit to a type cost nothing.
     *
     * @param source - the objects at this level to read values from
     * @param filter - the requirement's filter, mapping loader key to parent
     *                 field
     * @param cache - this dependency's cache entry, consulted for `id` keys
     * @returns the filter to hand the loader
     * @throws TypeError if `source` is missing, which would mean the level above
     *         attached nothing and the chain is broken
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
            arg[prop] = [
                ...new Set(
                    src.reduce((res, item) => {
                        res.push(
                            ...((Array.isArray(item[filter[prop].name])
                                ? item[filter[prop].name]
                                : [item[filter[prop].name]]) as any[]),
                        );

                        return res;
                    }, []),
                ),
            ].filter(val => !!val);

            // for id filters - check against cached data to not load
            // anything being already loaded
            if (prop === 'id') {
                arg[prop] = arg[prop].filter(
                    (id: any) => !(cache && cache.data && cache.data[id]),
                );
            }
        }

        return arg;
    }

    /**
     * Loads one level of dependencies onto `source`, then recurses into the
     * children it just attached.
     *
     * @remarks
     * The level's own work — the initializer, if it does not have to be waited
     * for, and every dependency loader — is issued concurrently and awaited
     * together. Only then does the next level start, because a child's filter is
     * built from values this level has just written.
     *
     * @param source - the objects to load dependencies onto
     * @param context - the resolver context, passed through untouched
     * @param fields - the fields requested at this level
     * @param cache - the request's resolution cache
     * @returns `source`, mutated in place
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
            field: string;
            dep: GraphQLDependency<any>;
        }> = [];

        if (this.init) {
            if (this.waitForInit(fields, gqlFields)) {
                await this.requestInitializer(source, context, fields, cache);
            } else {
                promises.push(
                    this.requestInitializer(source, context, fields, cache),
                );
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

                    promises.push(
                        this.requestLoader(source, context, option, dep, cache),
                    );
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

                promises.push(
                    child.dep.incrementalLoad(
                        src,
                        context,
                        fields[child.field],
                        cache,
                    ),
                );
            }

            if (promises.length) {
                // next level dependencies as recursive call
                await Promise.all(promises);
            }
        }

        return source;
    }

    /**
     * Flattens the objects held under one field across every object at this
     * level, giving the next level down a plain list to work from.
     *
     * @remarks
     * The field may hold a single object or a list, and either way the result is
     * one flat array — which is what lets the recursion treat every level the
     * same. Objects with nothing under the field contribute nothing.
     *
     * @param source - the objects at this level
     * @param field - the field to descend into; falsy returns this level as-is
     * @returns the child objects, flattened
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
     * Reports whether the initializer has to finish before any dependency at
     * this level may be loaded — which is the case when some dependency filters
     * on a field the initializer is the one to fill.
     *
     * @param fields - the fields the request asked for at this level
     * @param gqlFields - this type's GraphQL field map, looked up by default
     * @returns `true` when loading must wait for the initializer
     */
    private waitForInit(
        fields: any,
        gqlFields = this.type.getFields(),
    ): boolean {
        if (!this.init) {
            // there is no initializer defined, so nothing to wait for
            return false;
        }

        // Resolved here rather than read from state set by load(): load() only
        // runs on the type the resolver called it for, so a nested type's own
        // initializer fields were never resolved and it always took the
        // blocking path below.
        const initFieldNames = (this.initFields || []).map(
            field => field().name,
        );

        if (!initFieldNames.length) {
            // No initializer fields were declared, so there is no way to tell
            // which dependency filters read one. Wait, because the alternative
            // is building a filter out of fields the initializer has not
            // written yet and silently loading the wrong data. Passing the
            // fields to defineInitializer() is what buys the parallelism back.
            return true;
        }

        for (const field of Object.keys(fields)) {
            if (!(fields[field] && gqlFields[field])) {
                continue;
            }

            const dep = GraphQLDependency.deps.get(gqlType(gqlFields[field]));

            // Every requested field is checked. Bailing out on the first
            // dependency that has no requirements registered would miss a later
            // one that does need the initializer.
            if (dep && checkDepInit(initFieldNames, this.options.get(dep))) {
                return true;
            }
        }

        return false;
    }

    /**
     * Runs the initializer and merges what it returns onto the objects at this
     * level, matching by id.
     *
     * @remarks
     * Cached against the request by type and requested fields, so a type reached
     * from several directions with the same field set is initialized once.
     * Objects without an `id` are skipped, since there is no key to look their
     * extra fields up by.
     *
     * @param source - the objects to initialize
     * @param context - the resolver context, passed through untouched
     * @param fields - the fields requested at this level, part of the cache key
     * @param cache - the request's resolution cache
     * @returns `source`, mutated in place
     */
    private async requestInitializer(
        source: ResultType,
        context: any,
        fields: any,
        cache: ResolutionCache,
    ) {
        const key = hash(this.type, ResolveMethod.INITIALIZER, fields);
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
     * Satisfies one requirement: builds its filter, calls the child's loader for
     * whatever is missing, and attaches the results to the parents.
     *
     * @remarks
     * Two shortcuts keep the call count down. An empty filter — everything
     * already cached, or no parent field values to match on — skips the loader
     * and maps from the cache alone. And a filter already used in this request
     * reuses that call's result, which is what lets two requirements that reduce
     * to the same lookup share one round trip.
     *
     * @param source - the parent objects to attach results to
     * @param context - the resolver context, passed through untouched
     * @param option - the requirement being satisfied
     * @param dep - the child type's description, whose loader is called
     * @param cache - the request's resolution cache
     * @returns `source`, with this requirement's field filled in
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
            return mapDependencyData(source, depCache.data, option);
        }

        const key = hash(dep.type, ResolveMethod.LOADER, filter);

        if (!(depCache && depCache.calls[key])) {
            const data = (
                await dep.loader(context, filter, depCache.fields)
            ).reduce((res, next) => {
                res[next.id] = next;

                return res;
            }, {});

            depCache.calls[key] = data;
            Object.assign(depCache.data, data);
        }

        return mapDependencyData(source, depCache.data, option);
    }
}

/**
 * The dependency description for a GraphQL object type — an alias for
 * {@link GraphQLDependency.create}, and the intended way to reach every method
 * on this package's API.
 *
 * @remarks
 * Reads as a static constructor at the call site, but it is a lookup: the
 * description is created on first use and the same one is returned afterwards.
 * That is what allows `Dependency(SomeType)` to appear in as many modules as is
 * convenient — a loader beside the type, requirements beside the relation, a
 * `load()` in the resolver — and still describe one type once.
 *
 * @example
 * ```typescript
 * Dependency(UserType).require(CompanyType, () => ({
 *     as: UserType.getFields().company,
 *     filter: {
 *         // the key belongs to CompanyType's loader filter, the value is the
 *         // field on UserType whose values fill it
 *         [CompanyType.getFields().id.name]:
 *             UserType.getFields().companyId,
 *     },
 * }));
 * ```
 *
 * @see {@link GraphQLDependency.create}
 */
export const Dependency = GraphQLDependency.create;
