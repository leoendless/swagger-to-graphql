import rp from 'request-promise';
import {
  GraphQLFieldConfig,
  GraphQLFieldConfigMap,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLResolveInfo,
  GraphQLSchema,
} from 'graphql';
import {
  Options,
  Endpoint,
  Endpoints,
  GraphQLParameters,
  RootGraphQLSchema,
  SwaggerToGraphQLOptions,
} from './types';
import { getAllEndPoints, loadRefs, loadSchema } from './swagger';
import {
  jsonSchemaTypeToGraphQL,
  mapParametersToFields,
  parseResponse,
} from './typeMap';

const resolver = (endpoint: Endpoint, options: Options) => async (
  _,
  args: GraphQLParameters,
  opts: SwaggerToGraphQLOptions,
  info: GraphQLResolveInfo,
) => {
  const proxy = !options.proxyUrl
    ? opts.GQLProxyBaseUrl
    : typeof options.proxyUrl === 'function'
    ? options.proxyUrl(opts)
    : options.proxyUrl;
  const req = endpoint.request(args, proxy);
  if (opts.headers) {
    const { host, ...otherHeaders } = opts.headers;
    req.headers = Object.assign(req.headers, otherHeaders, options.headers);
  } else {
    req.headers = Object.assign(req.headers, options.headers);
  }
  const res = await rp({ ...options, ...req });
  return parseResponse(res, info.returnType);
};

const getFields = (
  endpoints: Endpoints,
  isMutation: boolean,
  gqlTypes,
  options,
): GraphQLFieldConfigMap<any, any> => {
  return Object.keys(endpoints)
    .filter((operationId: string) => {
      return !!endpoints[operationId].mutation === !!isMutation;
    })
    .reduce((result, operationId) => {
      const endpoint: Endpoint = endpoints[operationId];
      const type = GraphQLNonNull(
        jsonSchemaTypeToGraphQL(
          operationId,
          endpoint.response || { type: 'string' },
          'response',
          false,
          gqlTypes,
        ),
      );
      const gType: GraphQLFieldConfig<any, any> = {
        type,
        description: endpoint.description,
        args: mapParametersToFields(endpoint.parameters, operationId, gqlTypes),
        resolve: resolver(endpoint, options),
      };
      return { ...result, [operationId]: gType };
    }, {});
};

const schemaFromEndpoints = (endpoints: Endpoints, options) => {
  const gqlTypes = {};
  const queryFields = getFields(endpoints, false, gqlTypes, options);
  if (!Object.keys(queryFields).length) {
    throw new Error('Did not find any GET endpoints');
  }
  const rootType = new GraphQLObjectType({
    name: 'Query',
    fields: queryFields,
  });

  const graphQLSchema: RootGraphQLSchema = {
    query: rootType,
  };

  const mutationFields = getFields(endpoints, true, gqlTypes, options);
  if (Object.keys(mutationFields).length) {
    graphQLSchema.mutation = new GraphQLObjectType({
      name: 'Mutation',
      fields: mutationFields,
    });
  }

  return new GraphQLSchema(graphQLSchema);
};

const build = async (swaggerPath: string, options?: Options | {}) => {
  const swaggerSchema = await loadSchema(swaggerPath);
  const refs = await loadRefs(swaggerPath);
  const endpoints = getAllEndPoints(swaggerSchema, refs);
  const schema = schemaFromEndpoints(endpoints, options);
  return schema;
};

module.exports = build;
export default build;
