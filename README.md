# @imqueue/graphql-dependency

[![Build Status](https://img.shields.io/github/actions/workflow/status/imqueue/graphql-dependency/build.yml)](https://github.com/imqueue/graphql-dependency)
[![codebeat badge](https://codebeat.co/badges/87c59873-d921-4a57-981b-9f8e0743776b)](https://codebeat.co/projects/github-com-imqueue-graphql-dependency-master)
[![Coverage Status](https://coveralls.io/repos/github/imqueue/graphql-dependency/badge.svg?branch=master)](https://coveralls.io/github/imqueue/graphql-dependency?branch=master)
[![Known Vulnerabilities](https://snyk.io/test/github/imqueue/graphql-dependency/badge.svg?targetFile=package.json)](https://snyk.io/test/github/imqueue/graphql-dependency?targetFile=package.json)
[![License](https://img.shields.io/badge/license-ISC-blue.svg)](https://rawgit.com/imqueue/cli/master/LICENSE)

Cross-service GraphQL dependency loading during query calls for @imqueue
ecosystem.

# Install

~~~bash
npm i --save @imqueue/graphql-dependency
~~~

# Usage

This module allows to describe cross-service dependencies and fetch user 
requested data in an optimal manner. Let's imagine we have 2 micro-services
serving `User` and `Company` data respectively. Let's assume User can be 
a team member of the Company. As well as Company can have User as an owner.

On GraphQL API level it may be represented by a following schema:

~~~graphql
type User {
    id: ID!
    name: String!
    email: String!
    phone: String!
    ownerOf: [Company]
    memberOf: [Company]
}
type Company {
    id: ID!
    name: String!
    description: String!
    ownerId: Int!
    owner: User
    members: [User]
}
~~~ 

Now we have a query which can fetch a user with all related data, like this:

~~~graphql
query user(id: "VXNlcjox") {
    id
    name
    email
    phone
    ownerOf {
        id
        name
        members {
            id
            name
            phone
        }
    }
    memberOf {
        id
        name
        owner {
            id
            name
            email
            phone
        }
    }
}
~~~

As seen from such query we would need to implement resolver recursively loading
companies data for user and user data for companies.

With this module it's possible to resolve such dependencies automatically and
fetch data in a most efficient way using caching and minimizing number of
request by defining the dependencies between entities and their loaders and 
initializers.

~~~typescript
import { Dependency } from '@imqueue/graphql-dependency';
import {
    GraphQLID,
    GraphQLList,
    GraphQLNonNull,
    GraphQLObjectType,
    GraphQLString,
} from 'graphql';
import { globalIdField } from 'graphql-relay';
// we referring @imqueue based clients here
import { userClient, companyClient } from '../clients';

/**
 * User type definition
 */
export const User = new GraphQLObjectType({
    name: 'User',
    fields: () => ({
        id: globalIdField(
            User.name,
            (user: userClient.User) => user.id + '',
        ),
        name: {
            type: new GraphQLNonNull(GraphQLString),
            resolve: (user: userClient.User) => user.name,
        },
        phone: {
            type: new GraphQLNonNull(GraphQLString),
            resolve: (user: userClient.User) => user.name,
        },
        email: {
            type: new GraphQLNonNull(GraphQLString),
            resolve: (user: userClient.User) => user.name,
        },
        ownerOf: {
            type: new GraphQLList(Company),
            resolve: (user: userClient.user) => user.name
        }
    }),
});

/**
 * Defining user type loader.
 * Loader defines how the entity should be loaded when it is a dependency of
 * another object. Fo example, When company needs to load a user it will call
 * this loader to fill the fields of User type. 
 */
Dependency(User).defineLoader(async (
    context: any,
    filter: any,
    fields: any,
): Promise<Array<Partial<userClient.User>>> =>
    // meaning context contain initialized user service client reference
    // BTW loader could implement any functionality fetching users list by
    // a given filter returning requested user fields
    // @see https://github.com/Mikhus/graphql-fields-list library, for example,
    // to extract fields map input from graphql request info object
    // Filter would contain data constructed from parent objects data set
    // using the Dependency filtering options defined in the require() calls.
    await context.user.list(filter, fields),
);

/**
 * Company type definition
 */
export const Company = new GraphQLObjectType({
    name: 'Company',
    fields: () => ({
        id: globalIdField(
            Company.name,
            (company: companyClient.Company) => company.id + '',
        ),
        name: {
            type: new GraphQLNonNull(GraphQLString),
            resolve: (company: companyClient.Company) => company.name,
        },
        description: {
            type: new GraphQLNonNull(GraphQLString),
            resolve: (company: companyClient.Company) => company.description,
        },
        ownerId: {
            type: new GraphQLNonNull(GraphQLID),
            resolve: (company: companyClient.Company) => company.ownerId,
        },
        owner: {
            type: User,
            resolve: (company: companyClient.Company) => company.owner,
        },
        members: {
            type: new GraphQLList(User),
            resolve: (company: companyClient.Company) => company.members,
        },
    }),
});

/**
 * Defining company type loader
 */
Dependency(Company).defineLoader(async (
    context: any,
    filter: any,
    fields: any,
): Promise<Array<Partial<companyClient.Company>>> =>
    // meaning context contain initialized company service client reference
    await context.company.list(filter, fields),
);

/**
 * Describing dependencies
 */
Dependency(Company).require(User, () => ({
    as: Company.getFields().owner,
    filter: {
        // here we assume that user loader implements fetching users list
        // by a filter containing list of user identifiers
        [User.getFields().id.name]: Company.getFields().ownerId,
    },
}), () => ({
    as: Company.getFields().members,
    filter: {
        // here we assume that user loader implements fetching list of users
        // by a filter containing list of related company identifiers
        'relatedCompanyIds': Company.getFields().id,
    },
}));

Dependency(User).require(Company, () => ({
    as: User.getFields().memberOf,
    filter: {
        'relatedMemberIds': User.getFields().id,
    },
}), () => ({
    as: User.getFields().ownerOf,
    filter: {
        [Company.getFields().ownerId]: User.getFields().id,
    },
}));
~~~

With this setup we assume that user and company loaders implements data fetching
by a defined dependency requirement filters. @imqueue ecosystem provides a
straightforward way dealing with filters/fields fetched from a user request,
or you can implement it any suitable way, for example having loaders 
implementation which directly makes database or key-value storage calls without
the need to create service layer.

Then on query implementation resolver we would act as this:

~~~typescript
async function resolve(
    source: any,
    args: any,
    context: any,
    info: GraphQLResolveInfo,
) {
    const fields = fieldsMap(info);
    const user = context.user.find(fromGlobalId(args.id).id);

    if (user) {
        // this call will fetch all dependent data and map it to a resulting
        // user object (modifying it)
        await Dependency(User).load([user], context, fields);
    }

    // now we are safe to return all the source data requested
    return user;
}
~~~

Dependency loader will do all the job calling the minimum amount of requests
required to fill the result data. If end user created a request containing
recursive nesting which falls into fetching process of the same data recursively
it will end up in a data mapping without an additional calls for each nesting
levels. Most of the data are not copied and is mapped by references, so the
memory footprint will be kept on minimal level as well.

## License

This project is licensed under the GNU General Public License v3.0.
See the [LICENSE](LICENSE)
