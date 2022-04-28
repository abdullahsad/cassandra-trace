'use strict';

var Promise = require('bluebird');
var _ = require('lodash');
var util = require('util');

var dseDriver = void 0;
try {
  // eslint-disable-next-line import/no-extraneous-dependencies, import/no-unresolved
  dseDriver = require('dse-driver');
} catch (e) {
  dseDriver = null;
}

var cql = Promise.promisifyAll(dseDriver || require('cassandra-driver'));

var buildError = require('../orm/apollo_error.js');
var datatypes = require('../validators/datatypes');
var schemer = require('../validators/schema');

var parser = {};

parser.callback_or_throw = function f(err, callback) {
  if (typeof callback === 'function') {
    callback(err);
    return;
  }
  throw err;
};

parser.extract_type = function f(val) {
  // decompose composite types
  var decomposed = val ? val.replace(/[\s]/g, '').split(/[<,>]/g) : [''];

  for (var d = 0; d < decomposed.length; d++) {
    if (_.has(datatypes, decomposed[d])) {
      return decomposed[d];
    }
  }

  return val;
};

parser.extract_typeDef = function f(val) {
  // decompose composite types
  var decomposed = val ? val.replace(/[\s]/g, '') : '';
  decomposed = decomposed.substr(decomposed.indexOf('<'), decomposed.length - decomposed.indexOf('<'));

  return decomposed;
};

parser.extract_altered_type = function f(normalizedModelSchema, diff) {
  var fieldName = diff.path[0];
  var type = '';
  if (diff.path.length > 1) {
    if (diff.path[1] === 'type') {
      type = diff.rhs;
      if (normalizedModelSchema.fields[fieldName].typeDef) {
        type += normalizedModelSchema.fields[fieldName].typeDef;
      }
    } else {
      type = normalizedModelSchema.fields[fieldName].type;
      type += diff.rhs;
    }
  } else {
    type = diff.rhs.type;
    if (diff.rhs.typeDef) type += diff.rhs.typeDef;
  }
  return type;
};

parser.get_db_value_expression = function f(schema, fieldName, fieldValue) {
  if (fieldValue == null || fieldValue === cql.types.unset) {
    return { query_segment: '?', parameter: fieldValue };
  }

  if (_.isPlainObject(fieldValue) && fieldValue.$db_function) {
    return fieldValue.$db_function;
  }

  var fieldType = schemer.get_field_type(schema, fieldName);
  var validators = schemer.get_validators(schema, fieldName);

  if (_.isArray(fieldValue) && fieldType !== 'list' && fieldType !== 'set' && fieldType !== 'frozen') {
    var val = fieldValue.map(function (v) {
      var dbVal = parser.get_db_value_expression(schema, fieldName, v);

      if (_.isPlainObject(dbVal) && dbVal.query_segment) return dbVal.parameter;
      return dbVal;
    });

    return { query_segment: '?', parameter: val };
  }

  var validationMessage = schemer.get_validation_message(validators, fieldValue);
  if (typeof validationMessage === 'function') {
    throw buildError('model.validator.invalidvalue', validationMessage(fieldValue, fieldName, fieldType));
  }

  if (fieldType === 'counter') {
    var counterQuerySegment = util.format('"%s"', fieldName);
    if (fieldValue >= 0) counterQuerySegment += ' + ?';else counterQuerySegment += ' - ?';
    fieldValue = Math.abs(fieldValue);
    return { query_segment: counterQuerySegment, parameter: fieldValue };
  }

  return { query_segment: '?', parameter: fieldValue };
};

parser.unset_not_allowed = function f(operation, schema, fieldName, callback) {
  if (schemer.is_primary_key_field(schema, fieldName)) {
    parser.callback_or_throw(buildError(`model.${operation}.unsetkey`, fieldName), callback);
    return true;
  }
  if (schemer.is_required_field(schema, fieldName)) {
    parser.callback_or_throw(buildError(`model.${operation}.unsetrequired`, fieldName), callback);
    return true;
  }
  return false;
};

parser.get_inplace_update_expression = function f(schema, fieldName, fieldValue, updateClauses, queryParams) {
  var $add = _.isPlainObject(fieldValue) && fieldValue.$add || false;
  var $append = _.isPlainObject(fieldValue) && fieldValue.$append || false;
  var $prepend = _.isPlainObject(fieldValue) && fieldValue.$prepend || false;
  var $replace = _.isPlainObject(fieldValue) && fieldValue.$replace || false;
  var $remove = _.isPlainObject(fieldValue) && fieldValue.$remove || false;

  fieldValue = $add || $append || $prepend || $replace || $remove || fieldValue;

  var dbVal = parser.get_db_value_expression(schema, fieldName, fieldValue);

  if (!_.isPlainObject(dbVal) || !dbVal.query_segment) {
    updateClauses.push(util.format('"%s"=%s', fieldName, dbVal));
    return;
  }

  var fieldType = schemer.get_field_type(schema, fieldName);

  if (['map', 'list', 'set'].includes(fieldType)) {
    if ($add || $append) {
      dbVal.query_segment = util.format('"%s" + %s', fieldName, dbVal.query_segment);
    } else if ($prepend) {
      if (fieldType === 'list') {
        dbVal.query_segment = util.format('%s + "%s"', dbVal.query_segment, fieldName);
      } else {
        throw buildError('model.update.invalidprependop', util.format('%s datatypes does not support $prepend, use $add instead', fieldType));
      }
    } else if ($remove) {
      dbVal.query_segment = util.format('"%s" - %s', fieldName, dbVal.query_segment);
      if (fieldType === 'map') dbVal.parameter = Object.keys(dbVal.parameter);
    }
  }

  if ($replace) {
    if (fieldType === 'map') {
      updateClauses.push(util.format('"%s"[?]=%s', fieldName, dbVal.query_segment));
      var replaceKeys = Object.keys(dbVal.parameter);
      var replaceValues = _.values(dbVal.parameter);
      if (replaceKeys.length === 1) {
        queryParams.push(replaceKeys[0]);
        queryParams.push(replaceValues[0]);
      } else {
        throw buildError('model.update.invalidreplaceop', '$replace in map does not support more than one item');
      }
    } else if (fieldType === 'list') {
      updateClauses.push(util.format('"%s"[?]=%s', fieldName, dbVal.query_segment));
      if (dbVal.parameter.length === 2) {
        queryParams.push(dbVal.parameter[0]);
        queryParams.push(dbVal.parameter[1]);
      } else {
        throw buildError('model.update.invalidreplaceop', '$replace in list should have exactly 2 items, first one as the index and the second one as the value');
      }
    } else {
      throw buildError('model.update.invalidreplaceop', util.format('%s datatypes does not support $replace', fieldType));
    }
  } else {
    updateClauses.push(util.format('"%s"=%s', fieldName, dbVal.query_segment));
    queryParams.push(dbVal.parameter);
  }
};

parser.get_update_value_expression = function f(instance, schema, updateValues, callback) {
  var updateClauses = [];
  var queryParams = [];

  if (schema.options && schema.options.timestamps) {
    if (!updateValues[schema.options.timestamps.updatedAt]) {
      updateValues[schema.options.timestamps.updatedAt] = { $db_function: 'toTimestamp(now())' };
    }
  }

  if (schema.options && schema.options.versions) {
    if (!updateValues[schema.options.versions.key]) {
      updateValues[schema.options.versions.key] = { $db_function: 'now()' };
    }
  }

  var errorHappened = Object.keys(updateValues).some(function (fieldName) {
    if (schema.fields[fieldName] === undefined || schema.fields[fieldName].virtual) return false;

    var fieldType = schemer.get_field_type(schema, fieldName);
    var fieldValue = updateValues[fieldName];

    if (fieldValue === undefined) {
      fieldValue = instance._get_default_value(fieldName);
      if (fieldValue === undefined) {
        return parser.unset_not_allowed('update', schema, fieldName, callback);
      } else if (!schema.fields[fieldName].rule || !schema.fields[fieldName].rule.ignore_default) {
        // did set a default value, ignore default is not set
        if (instance.validate(fieldName, fieldValue) !== true) {
          parser.callback_or_throw(buildError('model.update.invaliddefaultvalue', fieldValue, fieldName, fieldType), callback);
          return true;
        }
      }
    }

    if (fieldValue === null || fieldValue === cql.types.unset) {
      if (parser.unset_not_allowed('update', schema, fieldName, callback)) {
        return true;
      }
    }

    try {
      parser.get_inplace_update_expression(schema, fieldName, fieldValue, updateClauses, queryParams);
    } catch (e) {
      parser.callback_or_throw(e, callback);
      return true;
    }
    return false;
  });

  return { updateClauses, queryParams, errorHappened };
};

parser.get_save_value_expression = function fn(instance, schema, callback) {
  var identifiers = [];
  var values = [];
  var queryParams = [];

  if (schema.options && schema.options.timestamps) {
    if (instance[schema.options.timestamps.updatedAt]) {
      instance[schema.options.timestamps.updatedAt] = { $db_function: 'toTimestamp(now())' };
    }
  }

  if (schema.options && schema.options.versions) {
    if (instance[schema.options.versions.key]) {
      instance[schema.options.versions.key] = { $db_function: 'now()' };
    }
  }

  var errorHappened = Object.keys(schema.fields).some(function (fieldName) {
    if (schema.fields[fieldName].virtual) return false;

    // check field value
    var fieldType = schemer.get_field_type(schema, fieldName);
    var fieldValue = instance[fieldName];

    if (fieldValue === undefined) {
      fieldValue = instance._get_default_value(fieldName);
      if (fieldValue === undefined) {
        return parser.unset_not_allowed('save', schema, fieldName, callback);
      } else if (!schema.fields[fieldName].rule || !schema.fields[fieldName].rule.ignore_default) {
        // did set a default value, ignore default is not set
        if (instance.validate(fieldName, fieldValue) !== true) {
          parser.callback_or_throw(buildError('model.save.invaliddefaultvalue', fieldValue, fieldName, fieldType), callback);
          return true;
        }
      }
    }

    if (fieldValue === null || fieldValue === cql.types.unset) {
      if (parser.unset_not_allowed('save', schema, fieldName, callback)) {
        return true;
      }
    }

    identifiers.push(util.format('"%s"', fieldName));

    try {
      var dbVal = parser.get_db_value_expression(schema, fieldName, fieldValue);
      if (_.isPlainObject(dbVal) && dbVal.query_segment) {
        values.push(dbVal.query_segment);
        queryParams.push(dbVal.parameter);
      } else {
        values.push(dbVal);
      }
    } catch (e) {
      parser.callback_or_throw(e, callback);
      return true;
    }
    return false;
  });

  return {
    identifiers,
    values,
    queryParams,
    errorHappened
  };
};

parser.extract_query_relations = function f(fieldName, relationKey, relationValue, schema, validOperators) {
  var queryRelations = [];
  var queryParams = [];

  if (!_.has(validOperators, relationKey.toLowerCase())) {
    throw buildError('model.find.invalidop', relationKey);
  }

  relationKey = relationKey.toLowerCase();
  if (relationKey === '$in' && !_.isArray(relationValue)) {
    throw buildError('model.find.invalidinop');
  }
  if (relationKey === '$token' && !(relationValue instanceof Object)) {
    throw buildError('model.find.invalidtoken');
  }

  var operator = validOperators[relationKey];
  var whereTemplate = '"%s" %s %s';

  var buildQueryRelations = function buildQueryRelations(fieldNameLocal, relationValueLocal) {
    var dbVal = parser.get_db_value_expression(schema, fieldNameLocal, relationValueLocal);
    if (_.isPlainObject(dbVal) && dbVal.query_segment) {
      queryRelations.push(util.format(whereTemplate, fieldNameLocal, operator, dbVal.query_segment));
      queryParams.push(dbVal.parameter);
    } else {
      queryRelations.push(util.format(whereTemplate, fieldNameLocal, operator, dbVal));
    }
  };

  var buildTokenQueryRelations = function buildTokenQueryRelations(tokenRelationKey, tokenRelationValue) {
    tokenRelationKey = tokenRelationKey.toLowerCase();
    if (_.has(validOperators, tokenRelationKey) && tokenRelationKey !== '$token' && tokenRelationKey !== '$in') {
      operator = validOperators[tokenRelationKey];
    } else {
      throw buildError('model.find.invalidtokenop', tokenRelationKey);
    }

    if (_.isArray(tokenRelationValue)) {
      var tokenKeys = fieldName.split(',');
      for (var tokenIndex = 0; tokenIndex < tokenRelationValue.length; tokenIndex++) {
        tokenKeys[tokenIndex] = tokenKeys[tokenIndex].trim();
        var dbVal = parser.get_db_value_expression(schema, tokenKeys[tokenIndex], tokenRelationValue[tokenIndex]);
        if (_.isPlainObject(dbVal) && dbVal.query_segment) {
          tokenRelationValue[tokenIndex] = dbVal.query_segment;
          queryParams.push(dbVal.parameter);
        } else {
          tokenRelationValue[tokenIndex] = dbVal;
        }
      }
      queryRelations.push(util.format(whereTemplate, tokenKeys.join('","'), operator, tokenRelationValue.toString()));
    } else {
      buildQueryRelations(fieldName, tokenRelationValue);
    }
  };

  if (relationKey === '$token') {
    whereTemplate = 'token("%s") %s token(%s)';

    var tokenRelationKeys = Object.keys(relationValue);
    for (var tokenRK = 0; tokenRK < tokenRelationKeys.length; tokenRK++) {
      var tokenRelationKey = tokenRelationKeys[tokenRK];
      var tokenRelationValue = relationValue[tokenRelationKey];
      buildTokenQueryRelations(tokenRelationKey, tokenRelationValue);
    }
  } else if (relationKey === '$contains') {
    var fieldType1 = schemer.get_field_type(schema, fieldName);
    if (['map', 'list', 'set', 'frozen'].includes(fieldType1)) {
      if (fieldType1 === 'map' && _.isPlainObject(relationValue)) {
        Object.keys(relationValue).forEach(function (key) {
          queryRelations.push(util.format('"%s"[%s] %s %s', fieldName, '?', '=', '?'));
          queryParams.push(key);
          queryParams.push(relationValue[key]);
        });
      } else {
        queryRelations.push(util.format(whereTemplate, fieldName, operator, '?'));
        queryParams.push(relationValue);
      }
    } else {
      throw buildError('model.find.invalidcontainsop');
    }
  } else if (relationKey === '$contains_key') {
    var fieldType2 = schemer.get_field_type(schema, fieldName);
    if (fieldType2 !== 'map') {
      throw buildError('model.find.invalidcontainskeyop');
    }
    queryRelations.push(util.format(whereTemplate, fieldName, operator, '?'));
    queryParams.push(relationValue);
  } else {
    buildQueryRelations(fieldName, relationValue);
  }
  return { queryRelations, queryParams };
};

parser._parse_query_object = function f(schema, queryObject) {
  var queryRelations = [];
  var queryParams = [];

  Object.keys(queryObject).forEach(function (fieldName) {
    if (fieldName.startsWith('$')) {
      // search queries based on lucene index or solr
      // escape all single quotes for queries in cassandra
      if (fieldName === '$expr') {
        if (typeof queryObject[fieldName].index === 'string' && typeof queryObject[fieldName].query === 'string') {
          queryRelations.push(util.format("expr(%s,'%s')", queryObject[fieldName].index, queryObject[fieldName].query.replace(/'/g, "''")));
        } else {
          throw buildError('model.find.invalidexpr');
        }
      } else if (fieldName === '$solr_query') {
        if (typeof queryObject[fieldName] === 'string') {
          queryRelations.push(util.format("solr_query='%s'", queryObject[fieldName].replace(/'/g, "''")));
        } else {
          throw buildError('model.find.invalidsolrquery');
        }
      }
      return;
    }

    var whereObject = queryObject[fieldName];
    // Array of operators
    if (!_.isArray(whereObject)) whereObject = [whereObject];

    for (var fk = 0; fk < whereObject.length; fk++) {
      var fieldRelation = whereObject[fk];

      var cqlOperators = {
        $eq: '=',
        $ne: '!=',
        $isnt: 'IS NOT',
        $gt: '>',
        $lt: '<',
        $gte: '>=',
        $lte: '<=',
        $in: 'IN',
        $like: 'LIKE',
        $token: 'token',
        $contains: 'CONTAINS',
        $contains_key: 'CONTAINS KEY'
      };

      if (_.isPlainObject(fieldRelation)) {
        var validKeys = Object.keys(cqlOperators);
        var fieldRelationKeys = Object.keys(fieldRelation);
        for (var i = 0; i < fieldRelationKeys.length; i++) {
          if (!validKeys.includes(fieldRelationKeys[i])) {
            // field relation key invalid, apply default $eq operator
            fieldRelation = { $eq: fieldRelation };
            break;
          }
        }
      } else {
        fieldRelation = { $eq: fieldRelation };
      }

      var relationKeys = Object.keys(fieldRelation);
      for (var rk = 0; rk < relationKeys.length; rk++) {
        var relationKey = relationKeys[rk];
        var relationValue = fieldRelation[relationKey];
        var extractedRelations = parser.extract_query_relations(fieldName, relationKey, relationValue, schema, cqlOperators);
        queryRelations = queryRelations.concat(extractedRelations.queryRelations);
        queryParams = queryParams.concat(extractedRelations.queryParams);
      }
    }
  });

  return { queryRelations, queryParams };
};

parser.get_filter_clause = function f(schema, queryObject, clause) {
  var parsedObject = parser._parse_query_object(schema, queryObject);
  var filterClause = {};
  if (parsedObject.queryRelations.length > 0) {
    filterClause.query = util.format('%s %s', clause, parsedObject.queryRelations.join(' AND '));
  } else {
    filterClause.query = '';
  }
  filterClause.params = parsedObject.queryParams;
  return filterClause;
};

parser.get_filter_clause_ddl = function f(schema, queryObject, clause) {
  var filterClause = parser.get_filter_clause(schema, queryObject, clause);
  var filterQuery = filterClause.query;
  filterClause.params.forEach(function (param) {
    var queryParam = void 0;
    if (typeof param === 'string') {
      queryParam = util.format("'%s'", param);
    } else if (param instanceof Date) {
      queryParam = util.format("'%s'", param.toISOString());
    } else if (param instanceof cql.types.Long || param instanceof cql.types.Integer || param instanceof cql.types.BigDecimal || param instanceof cql.types.TimeUuid || param instanceof cql.types.Uuid) {
      queryParam = param.toString();
    } else if (param instanceof cql.types.LocalDate || param instanceof cql.types.LocalTime || param instanceof cql.types.InetAddress) {
      queryParam = util.format("'%s'", param.toString());
    } else {
      queryParam = param;
    }
    // TODO: unhandled if queryParam is a string containing ? character
    // though this is unlikely to have in materialized view filters, but...
    filterQuery = filterQuery.replace('?', queryParam);
  });
  return filterQuery;
};

parser.get_where_clause = function f(schema, queryObject) {
  return parser.get_filter_clause(schema, queryObject, 'WHERE');
};

parser.get_if_clause = function f(schema, queryObject) {
  return parser.get_filter_clause(schema, queryObject, 'IF');
};

parser.get_primary_key_clauses = function f(schema) {
  var partitionKey = schema.key[0];
  var clusteringKey = schema.key.slice(1, schema.key.length);
  var clusteringOrder = [];

  for (var field = 0; field < clusteringKey.length; field++) {
    if (schema.clustering_order && schema.clustering_order[clusteringKey[field]] && schema.clustering_order[clusteringKey[field]].toLowerCase() === 'desc') {
      clusteringOrder.push(util.format('"%s" DESC', clusteringKey[field]));
    } else {
      clusteringOrder.push(util.format('"%s" ASC', clusteringKey[field]));
    }
  }

  var clusteringOrderClause = '';
  if (clusteringOrder.length > 0) {
    clusteringOrderClause = util.format(' WITH CLUSTERING ORDER BY (%s)', clusteringOrder.toString());
  }

  var partitionKeyClause = '';
  if (_.isArray(partitionKey)) {
    partitionKeyClause = partitionKey.map(function (v) {
      return util.format('"%s"', v);
    }).join(',');
  } else {
    partitionKeyClause = util.format('"%s"', partitionKey);
  }

  var clusteringKeyClause = '';
  if (clusteringKey.length) {
    clusteringKey = clusteringKey.map(function (v) {
      return util.format('"%s"', v);
    }).join(',');
    clusteringKeyClause = util.format(',%s', clusteringKey);
  }

  return { partitionKeyClause, clusteringKeyClause, clusteringOrderClause };
};

parser.get_mview_where_clause = function f(schema, viewSchema) {
  var clauses = parser.get_primary_key_clauses(viewSchema);
  var whereClause = clauses.partitionKeyClause.split(',').join(' IS NOT NULL AND ');
  if (clauses.clusteringKeyClause) whereClause += clauses.clusteringKeyClause.split(',').join(' IS NOT NULL AND ');
  whereClause += ' IS NOT NULL';

  var filters = _.cloneDeep(viewSchema.filters);

  if (_.isPlainObject(filters)) {
    // delete primary key fields defined as isn't null in filters
    Object.keys(filters).forEach(function (filterKey) {
      if (filters[filterKey].$isnt === null && (viewSchema.key.includes(filterKey) || viewSchema.key[0].includes(filterKey))) {
        delete filters[filterKey].$isnt;
      }
    });

    var filterClause = parser.get_filter_clause_ddl(schema, filters, 'AND');
    whereClause += util.format(' %s', filterClause).replace(/IS NOT null/g, 'IS NOT NULL');
  }

  // remove unnecessarily quoted field names in generated where clause
  // so that it matches the where_clause from database schema
  var quotedFieldNames = whereClause.match(/"(.*?)"/g);
  quotedFieldNames.forEach(function (fieldName) {
    var unquotedFieldName = fieldName.replace(/"/g, '');
    var reservedKeywords = ['ADD', 'AGGREGATE', 'ALLOW', 'ALTER', 'AND', 'ANY', 'APPLY', 'ASC', 'AUTHORIZE', 'BATCH', 'BEGIN', 'BY', 'COLUMNFAMILY', 'CREATE', 'DELETE', 'DESC', 'DROP', 'EACH_QUORUM', 'ENTRIES', 'FROM', 'FULL', 'GRANT', 'IF', 'IN', 'INDEX', 'INET', 'INFINITY', 'INSERT', 'INTO', 'KEYSPACE', 'KEYSPACES', 'LIMIT', 'LOCAL_ONE', 'LOCAL_QUORUM', 'MATERIALIZED', 'MODIFY', 'NAN', 'NORECURSIVE', 'NOT', 'OF', 'ON', 'ONE', 'ORDER', 'PARTITION', 'PASSWORD', 'PER', 'PRIMARY', 'QUORUM', 'RENAME', 'REVOKE', 'SCHEMA', 'SELECT', 'SET', 'TABLE', 'TIME', 'THREE', 'TO', 'TOKEN', 'TRUNCATE', 'TWO', 'UNLOGGED', 'UPDATE', 'USE', 'USING', 'VIEW', 'WHERE', 'WITH'];
    if (unquotedFieldName === unquotedFieldName.toLowerCase() && !reservedKeywords.includes(unquotedFieldName.toUpperCase())) {
      whereClause = whereClause.replace(fieldName, unquotedFieldName);
    }
  });
  return whereClause.trim();
};

parser.get_orderby_clause = function f(queryObject) {
  var orderKeys = [];
  Object.keys(queryObject).forEach(function (k) {
    var queryItem = queryObject[k];
    if (k.toLowerCase() === '$orderby') {
      if (!(queryItem instanceof Object)) {
        throw buildError('model.find.invalidorder');
      }
      var orderItemKeys = Object.keys(queryItem);

      for (var i = 0; i < orderItemKeys.length; i++) {
        var cqlOrderDirection = { $asc: 'ASC', $desc: 'DESC' };
        if (orderItemKeys[i].toLowerCase() in cqlOrderDirection) {
          var orderFields = queryItem[orderItemKeys[i]];

          if (!_.isArray(orderFields)) {
            orderFields = [orderFields];
          }

          for (var j = 0; j < orderFields.length; j++) {
            orderKeys.push(util.format('"%s" %s', orderFields[j], cqlOrderDirection[orderItemKeys[i]]));
          }
        } else {
          throw buildError('model.find.invalidordertype', orderItemKeys[i]);
        }
      }
    }
  });
  return orderKeys.length ? util.format('ORDER BY %s', orderKeys.join(', ')) : '';
};

parser.get_groupby_clause = function f(queryObject) {
  var groupbyKeys = [];

  Object.keys(queryObject).forEach(function (k) {
    var queryItem = queryObject[k];

    if (k.toLowerCase() === '$groupby') {
      if (!(queryItem instanceof Array)) {
        throw buildError('model.find.invalidgroup');
      }

      groupbyKeys = groupbyKeys.concat(queryItem);
    }
  });

  groupbyKeys = groupbyKeys.map(function (key) {
    return `"${key}"`;
  });

  return groupbyKeys.length ? util.format('GROUP BY %s', groupbyKeys.join(', ')) : '';
};

parser.get_limit_clause = function f(queryObject) {
  var limitClause = '';
  Object.keys(queryObject).forEach(function (k) {
    var queryItem = queryObject[k];
    if (k.toLowerCase() === '$limit' || k.toLowerCase() === '$per_partition_limit') {
      if (typeof queryItem !== 'number') throw buildError('model.find.limittype');
      limitClause = util.format('LIMIT %s', queryItem);
    }
    if (k.toLowerCase() === '$per_partition_limit') {
      limitClause = util.format('PER PARTITION %s', limitClause);
    }
  });
  return limitClause;
};

parser.get_select_clause = function f(options) {
  var selectClause = '*';
  if (options.select && _.isArray(options.select) && options.select.length > 0) {
    var selectArray = [];
    for (var i = 0; i < options.select.length; i++) {
      // separate the aggregate function and the column name if select is an aggregate function
      var selection = options.select[i].split(/[(, )]/g).filter(function (e) {
        return e;
      });
      if (selection.length === 1) {
        if (selection[0] === '*') selectArray.push('*');else selectArray.push(util.format('"%s"', selection[0]));
      } else if (selection.length === 2) {
        selectArray.push(util.format('%s("%s")', selection[0], selection[1]));
      } else if (selection.length >= 3 && selection[selection.length - 2].toLowerCase() === 'as') {
        var selectionEndChunk = selection.splice(selection.length - 2);
        var selectionChunk = '';
        if (selection.length === 1) {
          selectionChunk = util.format('"%s"', selection[0]);
        } else if (selection.length === 2) {
          selectionChunk = util.format('%s("%s")', selection[0], selection[1]);
        } else {
          selectionChunk = util.format('%s(%s)', selection[0], `"${selection.splice(1).join('","')}"`);
        }
        selectArray.push(util.format('%s AS "%s"', selectionChunk, selectionEndChunk[1]));
      } else if (selection.length >= 3) {
        selectArray.push(util.format('%s(%s)', selection[0], `"${selection.splice(1).join('","')}"`));
      }
    }
    selectClause = selectArray.join(',');
  }
  return selectClause.trim();
};

module.exports = parser;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy91dGlscy9wYXJzZXIuanMiXSwibmFtZXMiOlsiUHJvbWlzZSIsInJlcXVpcmUiLCJfIiwidXRpbCIsImRzZURyaXZlciIsImUiLCJjcWwiLCJwcm9taXNpZnlBbGwiLCJidWlsZEVycm9yIiwiZGF0YXR5cGVzIiwic2NoZW1lciIsInBhcnNlciIsImNhbGxiYWNrX29yX3Rocm93IiwiZiIsImVyciIsImNhbGxiYWNrIiwiZXh0cmFjdF90eXBlIiwidmFsIiwiZGVjb21wb3NlZCIsInJlcGxhY2UiLCJzcGxpdCIsImQiLCJsZW5ndGgiLCJoYXMiLCJleHRyYWN0X3R5cGVEZWYiLCJzdWJzdHIiLCJpbmRleE9mIiwiZXh0cmFjdF9hbHRlcmVkX3R5cGUiLCJub3JtYWxpemVkTW9kZWxTY2hlbWEiLCJkaWZmIiwiZmllbGROYW1lIiwicGF0aCIsInR5cGUiLCJyaHMiLCJmaWVsZHMiLCJ0eXBlRGVmIiwiZ2V0X2RiX3ZhbHVlX2V4cHJlc3Npb24iLCJzY2hlbWEiLCJmaWVsZFZhbHVlIiwidHlwZXMiLCJ1bnNldCIsInF1ZXJ5X3NlZ21lbnQiLCJwYXJhbWV0ZXIiLCJpc1BsYWluT2JqZWN0IiwiJGRiX2Z1bmN0aW9uIiwiZmllbGRUeXBlIiwiZ2V0X2ZpZWxkX3R5cGUiLCJ2YWxpZGF0b3JzIiwiZ2V0X3ZhbGlkYXRvcnMiLCJpc0FycmF5IiwibWFwIiwidiIsImRiVmFsIiwidmFsaWRhdGlvbk1lc3NhZ2UiLCJnZXRfdmFsaWRhdGlvbl9tZXNzYWdlIiwiY291bnRlclF1ZXJ5U2VnbWVudCIsImZvcm1hdCIsIk1hdGgiLCJhYnMiLCJ1bnNldF9ub3RfYWxsb3dlZCIsIm9wZXJhdGlvbiIsImlzX3ByaW1hcnlfa2V5X2ZpZWxkIiwiaXNfcmVxdWlyZWRfZmllbGQiLCJnZXRfaW5wbGFjZV91cGRhdGVfZXhwcmVzc2lvbiIsInVwZGF0ZUNsYXVzZXMiLCJxdWVyeVBhcmFtcyIsIiRhZGQiLCIkYXBwZW5kIiwiJHByZXBlbmQiLCIkcmVwbGFjZSIsIiRyZW1vdmUiLCJwdXNoIiwiaW5jbHVkZXMiLCJPYmplY3QiLCJrZXlzIiwicmVwbGFjZUtleXMiLCJyZXBsYWNlVmFsdWVzIiwidmFsdWVzIiwiZ2V0X3VwZGF0ZV92YWx1ZV9leHByZXNzaW9uIiwiaW5zdGFuY2UiLCJ1cGRhdGVWYWx1ZXMiLCJvcHRpb25zIiwidGltZXN0YW1wcyIsInVwZGF0ZWRBdCIsInZlcnNpb25zIiwia2V5IiwiZXJyb3JIYXBwZW5lZCIsInNvbWUiLCJ1bmRlZmluZWQiLCJ2aXJ0dWFsIiwiX2dldF9kZWZhdWx0X3ZhbHVlIiwicnVsZSIsImlnbm9yZV9kZWZhdWx0IiwidmFsaWRhdGUiLCJnZXRfc2F2ZV92YWx1ZV9leHByZXNzaW9uIiwiZm4iLCJpZGVudGlmaWVycyIsImV4dHJhY3RfcXVlcnlfcmVsYXRpb25zIiwicmVsYXRpb25LZXkiLCJyZWxhdGlvblZhbHVlIiwidmFsaWRPcGVyYXRvcnMiLCJxdWVyeVJlbGF0aW9ucyIsInRvTG93ZXJDYXNlIiwib3BlcmF0b3IiLCJ3aGVyZVRlbXBsYXRlIiwiYnVpbGRRdWVyeVJlbGF0aW9ucyIsImZpZWxkTmFtZUxvY2FsIiwicmVsYXRpb25WYWx1ZUxvY2FsIiwiYnVpbGRUb2tlblF1ZXJ5UmVsYXRpb25zIiwidG9rZW5SZWxhdGlvbktleSIsInRva2VuUmVsYXRpb25WYWx1ZSIsInRva2VuS2V5cyIsInRva2VuSW5kZXgiLCJ0cmltIiwiam9pbiIsInRvU3RyaW5nIiwidG9rZW5SZWxhdGlvbktleXMiLCJ0b2tlblJLIiwiZmllbGRUeXBlMSIsImZvckVhY2giLCJmaWVsZFR5cGUyIiwiX3BhcnNlX3F1ZXJ5X29iamVjdCIsInF1ZXJ5T2JqZWN0Iiwic3RhcnRzV2l0aCIsImluZGV4IiwicXVlcnkiLCJ3aGVyZU9iamVjdCIsImZrIiwiZmllbGRSZWxhdGlvbiIsImNxbE9wZXJhdG9ycyIsIiRlcSIsIiRuZSIsIiRpc250IiwiJGd0IiwiJGx0IiwiJGd0ZSIsIiRsdGUiLCIkaW4iLCIkbGlrZSIsIiR0b2tlbiIsIiRjb250YWlucyIsIiRjb250YWluc19rZXkiLCJ2YWxpZEtleXMiLCJmaWVsZFJlbGF0aW9uS2V5cyIsImkiLCJyZWxhdGlvbktleXMiLCJyayIsImV4dHJhY3RlZFJlbGF0aW9ucyIsImNvbmNhdCIsImdldF9maWx0ZXJfY2xhdXNlIiwiY2xhdXNlIiwicGFyc2VkT2JqZWN0IiwiZmlsdGVyQ2xhdXNlIiwicGFyYW1zIiwiZ2V0X2ZpbHRlcl9jbGF1c2VfZGRsIiwiZmlsdGVyUXVlcnkiLCJwYXJhbSIsInF1ZXJ5UGFyYW0iLCJEYXRlIiwidG9JU09TdHJpbmciLCJMb25nIiwiSW50ZWdlciIsIkJpZ0RlY2ltYWwiLCJUaW1lVXVpZCIsIlV1aWQiLCJMb2NhbERhdGUiLCJMb2NhbFRpbWUiLCJJbmV0QWRkcmVzcyIsImdldF93aGVyZV9jbGF1c2UiLCJnZXRfaWZfY2xhdXNlIiwiZ2V0X3ByaW1hcnlfa2V5X2NsYXVzZXMiLCJwYXJ0aXRpb25LZXkiLCJjbHVzdGVyaW5nS2V5Iiwic2xpY2UiLCJjbHVzdGVyaW5nT3JkZXIiLCJmaWVsZCIsImNsdXN0ZXJpbmdfb3JkZXIiLCJjbHVzdGVyaW5nT3JkZXJDbGF1c2UiLCJwYXJ0aXRpb25LZXlDbGF1c2UiLCJjbHVzdGVyaW5nS2V5Q2xhdXNlIiwiZ2V0X212aWV3X3doZXJlX2NsYXVzZSIsInZpZXdTY2hlbWEiLCJjbGF1c2VzIiwid2hlcmVDbGF1c2UiLCJmaWx0ZXJzIiwiY2xvbmVEZWVwIiwiZmlsdGVyS2V5IiwicXVvdGVkRmllbGROYW1lcyIsIm1hdGNoIiwidW5xdW90ZWRGaWVsZE5hbWUiLCJyZXNlcnZlZEtleXdvcmRzIiwidG9VcHBlckNhc2UiLCJnZXRfb3JkZXJieV9jbGF1c2UiLCJvcmRlcktleXMiLCJrIiwicXVlcnlJdGVtIiwib3JkZXJJdGVtS2V5cyIsImNxbE9yZGVyRGlyZWN0aW9uIiwiJGFzYyIsIiRkZXNjIiwib3JkZXJGaWVsZHMiLCJqIiwiZ2V0X2dyb3VwYnlfY2xhdXNlIiwiZ3JvdXBieUtleXMiLCJBcnJheSIsImdldF9saW1pdF9jbGF1c2UiLCJsaW1pdENsYXVzZSIsImdldF9zZWxlY3RfY2xhdXNlIiwic2VsZWN0Q2xhdXNlIiwic2VsZWN0Iiwic2VsZWN0QXJyYXkiLCJzZWxlY3Rpb24iLCJmaWx0ZXIiLCJzZWxlY3Rpb25FbmRDaHVuayIsInNwbGljZSIsInNlbGVjdGlvbkNodW5rIiwibW9kdWxlIiwiZXhwb3J0cyJdLCJtYXBwaW5ncyI6Ijs7QUFBQSxJQUFNQSxVQUFVQyxRQUFRLFVBQVIsQ0FBaEI7QUFDQSxJQUFNQyxJQUFJRCxRQUFRLFFBQVIsQ0FBVjtBQUNBLElBQU1FLE9BQU9GLFFBQVEsTUFBUixDQUFiOztBQUVBLElBQUlHLGtCQUFKO0FBQ0EsSUFBSTtBQUNGO0FBQ0FBLGNBQVlILFFBQVEsWUFBUixDQUFaO0FBQ0QsQ0FIRCxDQUdFLE9BQU9JLENBQVAsRUFBVTtBQUNWRCxjQUFZLElBQVo7QUFDRDs7QUFFRCxJQUFNRSxNQUFNTixRQUFRTyxZQUFSLENBQXFCSCxhQUFhSCxRQUFRLGtCQUFSLENBQWxDLENBQVo7O0FBRUEsSUFBTU8sYUFBYVAsUUFBUSx3QkFBUixDQUFuQjtBQUNBLElBQU1RLFlBQVlSLFFBQVEseUJBQVIsQ0FBbEI7QUFDQSxJQUFNUyxVQUFVVCxRQUFRLHNCQUFSLENBQWhCOztBQUVBLElBQU1VLFNBQVMsRUFBZjs7QUFFQUEsT0FBT0MsaUJBQVAsR0FBMkIsU0FBU0MsQ0FBVCxDQUFXQyxHQUFYLEVBQWdCQyxRQUFoQixFQUEwQjtBQUNuRCxNQUFJLE9BQU9BLFFBQVAsS0FBb0IsVUFBeEIsRUFBb0M7QUFDbENBLGFBQVNELEdBQVQ7QUFDQTtBQUNEO0FBQ0QsUUFBT0EsR0FBUDtBQUNELENBTkQ7O0FBUUFILE9BQU9LLFlBQVAsR0FBc0IsU0FBU0gsQ0FBVCxDQUFXSSxHQUFYLEVBQWdCO0FBQ3BDO0FBQ0EsTUFBTUMsYUFBYUQsTUFBTUEsSUFBSUUsT0FBSixDQUFZLE9BQVosRUFBcUIsRUFBckIsRUFBeUJDLEtBQXpCLENBQStCLFFBQS9CLENBQU4sR0FBaUQsQ0FB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QUFZM0ksSUFBWixDQUFpQnBFLEtBQUtxRCxNQUFMLENBQVksUUFBWixFQUFzQjJKLFVBQVUsQ0FBVixDQUF0QixFQUFxQyxJQUFHQSxVQUFVRyxNQUFWLENBQWlCLENBQWpCLEVBQW9CcEcsSUFBcEIsQ0FBeUIsS0FBekIsQ0FBZ0MsR0FBeEUsQ0FBakI7QUFDRDtBQUNGO0FBQ0Q4RixtQkFBZUUsWUFBWWhHLElBQVosQ0FBaUIsR0FBakIsQ0FBZjtBQUNEO0FBQ0QsU0FBTzhGLGFBQWEvRixJQUFiLEVBQVA7QUFDRCxDQTlCRDs7QUFnQ0F1RyxPQUFPQyxPQUFQLEdBQWlCOU0sTUFBakIiLCJmaWxlIjoicGFyc2VyLmpzIiwic291cmNlc0NvbnRlbnQiOlsiY29uc3QgUHJvbWlzZSA9IHJlcXVpcmUoJ2JsdWViaXJkJyk7XG5jb25zdCBfID0gcmVxdWlyZSgnbG9kYXNoJyk7XG5jb25zdCB1dGlsID0gcmVxdWlyZSgndXRpbCcpO1xuXG5sZXQgZHNlRHJpdmVyO1xudHJ5IHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIGltcG9ydC9uby1leHRyYW5lb3VzLWRlcGVuZGVuY2llcywgaW1wb3J0L25vLXVucmVzb2x2ZWRcbiAgZHNlRHJpdmVyID0gcmVxdWlyZSgnZHNlLWRyaXZlcicpO1xufSBjYXRjaCAoZSkge1xuICBkc2VEcml2ZXIgPSBudWxsO1xufVxuXG5jb25zdCBjcWwgPSBQcm9taXNlLnByb21pc2lmeUFsbChkc2VEcml2ZXIgfHwgcmVxdWlyZSgnY2Fzc2FuZHJhLWRyaXZlcicpKTtcblxuY29uc3QgYnVpbGRFcnJvciA9IHJlcXVpcmUoJy4uL29ybS9hcG9sbG9fZXJyb3IuanMnKTtcbmNvbnN0IGRhdGF0eXBlcyA9IHJlcXVpcmUoJy4uL3ZhbGlkYXRvcnMvZGF0YXR5cGVzJyk7XG5jb25zdCBzY2hlbWVyID0gcmVxdWlyZSgnLi4vdmFsaWRhdG9ycy9zY2hlbWEnKTtcblxuY29uc3QgcGFyc2VyID0ge307XG5cbnBhcnNlci5jYWxsYmFja19vcl90aHJvdyA9IGZ1bmN0aW9uIGYoZXJyLCBjYWxsYmFjaykge1xuICBpZiAodHlwZW9mIGNhbGxiYWNrID09PSAnZnVuY3Rpb24nKSB7XG4gICAgY2FsbGJhY2soZXJyKTtcbiAgICByZXR1cm47XG4gIH1cbiAgdGhyb3cgKGVycik7XG59O1xuXG5wYXJzZXIuZXh0cmFjdF90eXBlID0gZnVuY3Rpb24gZih2YWwpIHtcbiAgLy8gZGVjb21wb3NlIGNvbXBvc2l0ZSB0eXBlc1xuICBjb25zdCBkZWNvbXBvc2VkID0gdmFsID8gdmFsLnJlcGxhY2UoL1tcXHNdL2csICcnKS5zcGxpdCgvWzwsPl0vZykgOiBbJyddO1xuXG4gIGZvciAobGV0IGQgPSAwOyBkIDwgZGVjb21wb3NlZC5sZW5ndGg7IGQrKykge1xuICAgIGlmIChfLmhhcyhkYXRhdHlwZXMsIGRlY29tcG9zZWRbZF0pKSB7XG4gICAgICByZXR1cm4gZGVjb21wb3NlZFtkXTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gdmFsO1xufTtcblxucGFyc2VyLmV4dHJhY3RfdHlwZURlZiA9IGZ1bmN0aW9uIGYodmFsKSB7XG4gIC8vIGRlY29tcG9zZSBjb21wb3NpdGUgdHlwZXNcbiAgbGV0IGRlY29tcG9zZWQgPSB2YWwgPyB2YWwucmVwbGFjZSgvW1xcc10vZywgJycpIDogJyc7XG4gIGRlY29tcG9zZWQgPSBkZWNvbXBvc2VkLnN1YnN0cihkZWNvbXBvc2VkLmluZGV4T2YoJzwnKSwgZGVjb21wb3NlZC5sZW5ndGggLSBkZWNvbXBvc2VkLmluZGV4T2YoJzwnKSk7XG5cbiAgcmV0dXJuIGRlY29tcG9zZWQ7XG59O1xuXG5wYXJzZXIuZXh0cmFjdF9hbHRlcmVkX3R5cGUgPSBmdW5jdGlvbiBmKG5vcm1hbGl6ZWRNb2RlbFNjaGVtYSwgZGlmZikge1xuICBjb25zdCBmaWVsZE5hbWUgPSBkaWZmLnBhdGhbMF07XG4gIGxldCB0eXBlID0gJyc7XG4gIGlmIChkaWZmLnBhdGgubGVuZ3RoID4gMSkge1xuICAgIGlmIChkaWZmLnBhdGhbMV0gPT09ICd0eXBlJykge1xuICAgICAgdHlwZSA9IGRpZmYucmhzO1xuICAgICAgaWYgKG5vcm1hbGl6ZWRNb2RlbFNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50eXBlRGVmKSB7XG4gICAgICAgIHR5cGUgKz0gbm9ybWFsaXplZE1vZGVsU2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGVEZWY7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHR5cGUgPSBub3JtYWxpemVkTW9kZWxTY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udHlwZTtcbiAgICAgIHR5cGUgKz0gZGlmZi5yaHM7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHR5cGUgPSBkaWZmLnJocy50eXBlO1xuICAgIGlmIChkaWZmLnJocy50eXBlRGVmKSB0eXBlICs9IGRpZmYucmhzLnR5cGVEZWY7XG4gIH1cbiAgcmV0dXJuIHR5cGU7XG59O1xuXG5wYXJzZXIuZ2V0X2RiX3ZhbHVlX2V4cHJlc3Npb24gPSBmdW5jdGlvbiBmKHNjaGVtYSwgZmllbGROYW1lLCBmaWVsZFZhbHVlKSB7XG4gIGlmIChmaWVsZFZhbHVlID09IG51bGwgfHwgZmllbGRWYWx1ZSA9PT0gY3FsLnR5cGVzLnVuc2V0KSB7XG4gICAgcmV0dXJuIHsgcXVlcnlfc2VnbWVudDogJz8nLCBwYXJhbWV0ZXI6IGZpZWxkVmFsdWUgfTtcbiAgfVxuXG4gIGlmIChfLmlzUGxhaW5PYmplY3QoZmllbGRWYWx1ZSkgJiYgZmllbGRWYWx1ZS4kZGJfZnVuY3Rpb24pIHtcbiAgICByZXR1cm4gZmllbGRWYWx1ZS4kZGJfZnVuY3Rpb247XG4gIH1cblxuICBjb25zdCBmaWVsZFR5cGUgPSBzY2hlbWVyLmdldF9maWVsZF90eXBlKHNjaGVtYSwgZmllbGROYW1lKTtcbiAgY29uc3QgdmFsaWRhdG9ycyA9IHNjaGVtZXIuZ2V0X3ZhbGlkYXRvcnMoc2NoZW1hLCBmaWVsZE5hbWUpO1xuXG4gIGlmIChfLmlzQXJyYXkoZmllbGRWYWx1ZSkgJiYgZmllbGRUeXBlICE9PSAnbGlzdCcgJiYgZmllbGRUeXBlICE9PSAnc2V0JyAmJiBmaWVsZFR5cGUgIT09ICdmcm96ZW4nKSB7XG4gICAgY29uc3QgdmFsID0gZmllbGRWYWx1ZS5tYXAoKHYpID0+IHtcbiAgICAgIGNvbnN0IGRiVmFsID0gcGFyc2VyLmdldF9kYl92YWx1ZV9leHByZXNzaW9uKHNjaGVtYSwgZmllbGROYW1lLCB2KTtcblxuICAgICAgaWYgKF8uaXNQbGFpbk9iamVjdChkYlZhbCkgJiYgZGJWYWwucXVlcnlfc2VnbWVudCkgcmV0dXJuIGRiVmFsLnBhcmFtZXRlcjtcbiAgICAgIHJldHVybiBkYlZhbDtcbiAgICB9KTtcblxuICAgIHJldHVybiB7IHF1ZXJ5X3NlZ21lbnQ6ICc/JywgcGFyYW1ldGVyOiB2YWwgfTtcbiAgfVxuXG4gIGNvbnN0IHZhbGlkYXRpb25NZXNzYWdlID0gc2NoZW1lci5nZXRfdmFsaWRhdGlvbl9tZXNzYWdlKHZhbGlkYXRvcnMsIGZpZWxkVmFsdWUpO1xuICBpZiAodHlwZW9mIHZhbGlkYXRpb25NZXNzYWdlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgdGhyb3cgKGJ1aWxkRXJyb3IoJ21vZGVsLnZhbGlkYXRvci5pbnZhbGlkdmFsdWUnLCB2YWxpZGF0aW9uTWVzc2FnZShmaWVsZFZhbHVlLCBmaWVsZE5hbWUsIGZpZWxkVHlwZSkpKTtcbiAgfVxuXG4gIGlmIChmaWVsZFR5cGUgPT09ICdjb3VudGVyJykge1xuICAgIGxldCBjb3VudGVyUXVlcnlTZWdtZW50ID0gdXRpbC5mb3JtYXQoJ1wiJXNcIicsIGZpZWxkTmFtZSk7XG4gICAgaWYgKGZpZWxkVmFsdWUgPj0gMCkgY291bnRlclF1ZXJ5U2VnbWVudCArPSAnICsgPyc7XG4gICAgZWxzZSBjb3VudGVyUXVlcnlTZWdtZW50ICs9ICcgLSA/JztcbiAgICBmaWVsZFZhbHVlID0gTWF0aC5hYnMoZmllbGRWYWx1ZSk7XG4gICAgcmV0dXJuIHsgcXVlcnlfc2VnbWVudDogY291bnRlclF1ZXJ5U2VnbWVudCwgcGFyYW1ldGVyOiBmaWVsZFZhbHVlIH07XG4gIH1cblxuICByZXR1cm4geyBxdWVyeV9zZWdtZW50OiAnPycsIHBhcmFtZXRlcjogZmllbGRWYWx1ZSB9O1xufTtcblxucGFyc2VyLnVuc2V0X25vdF9hbGxvd2VkID0gZnVuY3Rpb24gZihvcGVyYXRpb24sIHNjaGVtYSwgZmllbGROYW1lLCBjYWxsYmFjaykge1xuICBpZiAoc2NoZW1lci5pc19wcmltYXJ5X2tleV9maWVsZChzY2hlbWEsIGZpZWxkTmFtZSkpIHtcbiAgICBwYXJzZXIuY2FsbGJhY2tfb3JfdGhyb3coYnVpbGRFcnJvcihgbW9kZWwuJHtvcGVyYXRpb259LnVuc2V0a2V5YCwgZmllbGROYW1lKSwgY2FsbGJhY2spO1xuICAgIHJldHVybiB0cnVlO1xuICB9XG4gIGlmIChzY2hlbWVyLmlzX3JlcXVpcmVkX2ZpZWxkKHNjaGVtYSwgZmllbGROYW1lKSkge1xuICAgIHBhcnNlci5jYWxsYmFja19vcl90aHJvdyhidWlsZEVycm9yKGBtb2RlbC4ke29wZXJhdGlvbn0udW5zZXRyZXF1aXJlZGAsIGZpZWxkTmFtZSksIGNhbGxiYWNrKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59O1xuXG5wYXJzZXIuZ2V0X2lucGxhY2VfdXBkYXRlX2V4cHJlc3Npb24gPSBmdW5jdGlvbiBmKHNjaGVtYSwgZmllbGROYW1lLCBmaWVsZFZhbHVlLCB1cGRhdGVDbGF1c2VzLCBxdWVyeVBhcmFtcykge1xuICBjb25zdCAkYWRkID0gKF8uaXNQbGFpbk9iamVjdChmaWVsZFZhbHVlKSAmJiBmaWVsZFZhbHVlLiRhZGQpIHx8IGZhbHNlO1xuICBjb25zdCAkYXBwZW5kID0gKF8uaXNQbGFpbk9iamVjdChmaWVsZFZhbHVlKSAmJiBmaWVsZFZhbHVlLiRhcHBlbmQpIHx8IGZhbHNlO1xuICBjb25zdCAkcHJlcGVuZCA9IChfLmlzUGxhaW5PYmplY3QoZmllbGRWYWx1ZSkgJiYgZmllbGRWYWx1ZS4kcHJlcGVuZCkgfHwgZmFsc2U7XG4gIGNvbnN0ICRyZXBsYWNlID0gKF8uaXNQbGFpbk9iamVjdChmaWVsZFZhbHVlKSAmJiBmaWVsZFZhbHVlLiRyZXBsYWNlKSB8fCBmYWxzZTtcbiAgY29uc3QgJHJlbW92ZSA9IChfLmlzUGxhaW5PYmplY3QoZmllbGRWYWx1ZSkgJiYgZmllbGRWYWx1ZS4kcmVtb3ZlKSB8fCBmYWxzZTtcblxuICBmaWVsZFZhbHVlID0gJGFkZCB8fCAkYXBwZW5kIHx8ICRwcmVwZW5kIHx8ICRyZXBsYWNlIHx8ICRyZW1vdmUgfHwgZmllbGRWYWx1ZTtcblxuICBjb25zdCBkYlZhbCA9IHBhcnNlci5nZXRfZGJfdmFsdWVfZXhwcmVzc2lvbihzY2hlbWEsIGZpZWxkTmFtZSwgZmllbGRWYWx1ZSk7XG5cbiAgaWYgKCFfLmlzUGxhaW5PYmplY3QoZGJWYWwpIHx8ICFkYlZhbC5xdWVyeV9zZWdtZW50KSB7XG4gICAgdXBkYXRlQ2xhdXNlcy5wdXNoKHV0aWwuZm9ybWF0KCdcIiVzXCI9JXMnLCBmaWVsZE5hbWUsIGRiVmFsKSk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3QgZmllbGRUeXBlID0gc2NoZW1lci5nZXRfZmllbGRfdHlwZShzY2hlbWEsIGZpZWxkTmFtZSk7XG5cbiAgaWYgKFsnbWFwJywgJ2xpc3QnLCAnc2V0J10uaW5jbHVkZXMoZmllbGRUeXBlKSkge1xuICAgIGlmICgkYWRkIHx8ICRhcHBlbmQpIHtcbiAgICAgIGRiVmFsLnF1ZXJ5X3NlZ21lbnQgPSB1dGlsLmZvcm1hdCgnXCIlc1wiICsgJXMnLCBmaWVsZE5hbWUsIGRiVmFsLnF1ZXJ5X3NlZ21lbnQpO1xuICAgIH0gZWxzZSBpZiAoJHByZXBlbmQpIHtcbiAgICAgIGlmIChmaWVsZFR5cGUgPT09ICdsaXN0Jykge1xuICAgICAgICBkYlZhbC5xdWVyeV9zZWdtZW50ID0gdXRpbC5mb3JtYXQoJyVzICsgXCIlc1wiJywgZGJWYWwucXVlcnlfc2VnbWVudCwgZmllbGROYW1lKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IChidWlsZEVycm9yKFxuICAgICAgICAgICdtb2RlbC51cGRhdGUuaW52YWxpZHByZXBlbmRvcCcsXG4gICAgICAgICAgdXRpbC5mb3JtYXQoJyVzIGRhdGF0eXBlcyBkb2VzIG5vdCBzdXBwb3J0ICRwcmVwZW5kLCB1c2UgJGFkZCBpbnN0ZWFkJywgZmllbGRUeXBlKSxcbiAgICAgICAgKSk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmICgkcmVtb3ZlKSB7XG4gICAgICBkYlZhbC5xdWVyeV9zZWdtZW50ID0gdXRpbC5mb3JtYXQoJ1wiJXNcIiAtICVzJywgZmllbGROYW1lLCBkYlZhbC5xdWVyeV9zZWdtZW50KTtcbiAgICAgIGlmIChmaWVsZFR5cGUgPT09ICdtYXAnKSBkYlZhbC5wYXJhbWV0ZXIgPSBPYmplY3Qua2V5cyhkYlZhbC5wYXJhbWV0ZXIpO1xuICAgIH1cbiAgfVxuXG4gIGlmICgkcmVwbGFjZSkge1xuICAgIGlmIChmaWVsZFR5cGUgPT09ICdtYXAnKSB7XG4gICAgICB1cGRhdGVDbGF1c2VzLnB1c2godXRpbC5mb3JtYXQoJ1wiJXNcIls/XT0lcycsIGZpZWxkTmFtZSwgZGJWYWwucXVlcnlfc2VnbWVudCkpO1xuICAgICAgY29uc3QgcmVwbGFjZUtleXMgPSBPYmplY3Qua2V5cyhkYlZhbC5wYXJhbWV0ZXIpO1xuICAgICAgY29uc3QgcmVwbGFjZVZhbHVlcyA9IF8udmFsdWVzKGRiVmFsLnBhcmFtZXRlcik7XG4gICAgICBpZiAocmVwbGFjZUtleXMubGVuZ3RoID09PSAxKSB7XG4gICAgICAgIHF1ZXJ5UGFyYW1zLnB1c2gocmVwbGFjZUtleXNbMF0pO1xuICAgICAgICBxdWVyeVBhcmFtcy5wdXNoKHJlcGxhY2VWYWx1ZXNbMF0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgKFxuICAgICAgICAgIGJ1aWxkRXJyb3IoJ21vZGVsLnVwZGF0ZS5pbnZhbGlkcmVwbGFjZW9wJywgJyRyZXBsYWNlIGluIG1hcCBkb2VzIG5vdCBzdXBwb3J0IG1vcmUgdGhhbiBvbmUgaXRlbScpXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChmaWVsZFR5cGUgPT09ICdsaXN0Jykge1xuICAgICAgdXBkYXRlQ2xhdXNlcy5wdXNoKHV0aWwuZm9ybWF0KCdcIiVzXCJbP109JXMnLCBmaWVsZE5hbWUsIGRiVmFsLnF1ZXJ5X3NlZ21lbnQpKTtcbiAgICAgIGlmIChkYlZhbC5wYXJhbWV0ZXIubGVuZ3RoID09PSAyKSB7XG4gICAgICAgIHF1ZXJ5UGFyYW1zLnB1c2goZGJWYWwucGFyYW1ldGVyWzBdKTtcbiAgICAgICAgcXVlcnlQYXJhbXMucHVzaChkYlZhbC5wYXJhbWV0ZXJbMV0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgKGJ1aWxkRXJyb3IoXG4gICAgICAgICAgJ21vZGVsLnVwZGF0ZS5pbnZhbGlkcmVwbGFjZW9wJyxcbiAgICAgICAgICAnJHJlcGxhY2UgaW4gbGlzdCBzaG91bGQgaGF2ZSBleGFjdGx5IDIgaXRlbXMsIGZpcnN0IG9uZSBhcyB0aGUgaW5kZXggYW5kIHRoZSBzZWNvbmQgb25lIGFzIHRoZSB2YWx1ZScsXG4gICAgICAgICkpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyAoYnVpbGRFcnJvcihcbiAgICAgICAgJ21vZGVsLnVwZGF0ZS5pbnZhbGlkcmVwbGFjZW9wJyxcbiAgICAgICAgdXRpbC5mb3JtYXQoJyVzIGRhdGF0eXBlcyBkb2VzIG5vdCBzdXBwb3J0ICRyZXBsYWNlJywgZmllbGRUeXBlKSxcbiAgICAgICkpO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB1cGRhdGVDbGF1c2VzLnB1c2godXRpbC5mb3JtYXQoJ1wiJXNcIj0lcycsIGZpZWxkTmFtZSwgZGJWYWwucXVlcnlfc2VnbWVudCkpO1xuICAgIHF1ZXJ5UGFyYW1zLnB1c2goZGJWYWwucGFyYW1ldGVyKTtcbiAgfVxufTtcblxucGFyc2VyLmdldF91cGRhdGVfdmFsdWVfZXhwcmVzc2lvbiA9IGZ1bmN0aW9uIGYoaW5zdGFuY2UsIHNjaGVtYSwgdXBkYXRlVmFsdWVzLCBjYWxsYmFjaykge1xuICBjb25zdCB1cGRhdGVDbGF1c2VzID0gW107XG4gIGNvbnN0IHF1ZXJ5UGFyYW1zID0gW107XG5cbiAgaWYgKHNjaGVtYS5vcHRpb25zICYmIHNjaGVtYS5vcHRpb25zLnRpbWVzdGFtcHMpIHtcbiAgICBpZiAoIXVwZGF0ZVZhbHVlc1tzY2hlbWEub3B0aW9ucy50aW1lc3RhbXBzLnVwZGF0ZWRBdF0pIHtcbiAgICAgIHVwZGF0ZVZhbHVlc1tzY2hlbWEub3B0aW9ucy50aW1lc3RhbXBzLnVwZGF0ZWRBdF0gPSB7ICRkYl9mdW5jdGlvbjogJ3RvVGltZXN0YW1wKG5vdygpKScgfTtcbiAgICB9XG4gIH1cblxuICBpZiAoc2NoZW1hLm9wdGlvbnMgJiYgc2NoZW1hLm9wdGlvbnMudmVyc2lvbnMpIHtcbiAgICBpZiAoIXVwZGF0ZVZhbHVlc1tzY2hlbWEub3B0aW9ucy52ZXJzaW9ucy5rZXldKSB7XG4gICAgICB1cGRhdGVWYWx1ZXNbc2NoZW1hLm9wdGlvbnMudmVyc2lvbnMua2V5XSA9IHsgJGRiX2Z1bmN0aW9uOiAnbm93KCknIH07XG4gICAgfVxuICB9XG5cbiAgY29uc3QgZXJyb3JIYXBwZW5lZCA9IE9iamVjdC5rZXlzKHVwZGF0ZVZhbHVlcykuc29tZSgoZmllbGROYW1lKSA9PiB7XG4gICAgaWYgKHNjaGVtYS5maWVsZHNbZmllbGROYW1lXSA9PT0gdW5kZWZpbmVkIHx8IHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS52aXJ0dWFsKSByZXR1cm4gZmFsc2U7XG5cbiAgICBjb25zdCBmaWVsZFR5cGUgPSBzY2hlbWVyLmdldF9maWVsZF90eXBlKHNjaGVtYSwgZmllbGROYW1lKTtcbiAgICBsZXQgZmllbGRWYWx1ZSA9IHVwZGF0ZVZhbHVlc1tmaWVsZE5hbWVdO1xuXG4gICAgaWYgKGZpZWxkVmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgZmllbGRWYWx1ZSA9IGluc3RhbmNlLl9nZXRfZGVmYXVsdF92YWx1ZShmaWVsZE5hbWUpO1xuICAgICAgaWYgKGZpZWxkVmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICByZXR1cm4gcGFyc2VyLnVuc2V0X25vdF9hbGxvd2VkKCd1cGRhdGUnLCBzY2hlbWEsIGZpZWxkTmFtZSwgY2FsbGJhY2spO1xuICAgICAgfSBlbHNlIGlmICghc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnJ1bGUgfHwgIXNjaGVtYS5maWVsZHNbZmllbGROYW1lXS5ydWxlLmlnbm9yZV9kZWZhdWx0KSB7XG4gICAgICAgIC8vIGRpZCBzZXQgYSBkZWZhdWx0IHZhbHVlLCBpZ25vcmUgZGVmYXVsdCBpcyBub3Qgc2V0XG4gICAgICAgIGlmIChpbnN0YW5jZS52YWxpZGF0ZShmaWVsZE5hbWUsIGZpZWxkVmFsdWUpICE9PSB0cnVlKSB7XG4gICAgICAgICAgcGFyc2VyLmNhbGxiYWNrX29yX3Rocm93KGJ1aWxkRXJyb3IoJ21vZGVsLnVwZGF0ZS5pbnZhbGlkZGVmYXVsdHZhbHVlJywgZmllbGRWYWx1ZSwgZmllbGROYW1lLCBmaWVsZFR5cGUpLCBjYWxsYmFjayk7XG4gICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZmllbGRWYWx1ZSA9PT0gbnVsbCB8fCBmaWVsZFZhbHVlID09PSBjcWwudHlwZXMudW5zZXQpIHtcbiAgICAgIGlmIChwYXJzZXIudW5zZXRfbm90X2FsbG93ZWQoJ3VwZGF0ZScsIHNjaGVtYSwgZmllbGROYW1lLCBjYWxsYmFjaykpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIHBhcnNlci5nZXRfaW5wbGFjZV91cGRhdGVfZXhwcmVzc2lvbihzY2hlbWEsIGZpZWxkTmFtZSwgZmllbGRWYWx1ZSwgdXBkYXRlQ2xhdXNlcywgcXVlcnlQYXJhbXMpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHBhcnNlci5jYWxsYmFja19vcl90aHJvdyhlLCBjYWxsYmFjayk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9KTtcblxuICByZXR1cm4geyB1cGRhdGVDbGF1c2VzLCBxdWVyeVBhcmFtcywgZXJyb3JIYXBwZW5lZCB9O1xufTtcblxucGFyc2VyLmdldF9zYXZlX3ZhbHVlX2V4cHJlc3Npb24gPSBmdW5jdGlvbiBmbihpbnN0YW5jZSwgc2NoZW1hLCBjYWxsYmFjaykge1xuICBjb25zdCBpZGVudGlmaWVycyA9IFtdO1xuICBjb25zdCB2YWx1ZXMgPSBbXTtcbiAgY29uc3QgcXVlcnlQYXJhbXMgPSBbXTtcblxuICBpZiAoc2NoZW1hLm9wdGlvbnMgJiYgc2NoZW1hLm9wdGlvbnMudGltZXN0YW1wcykge1xuICAgIGlmIChpbnN0YW5jZVtzY2hlbWEub3B0aW9ucy50aW1lc3RhbXBzLnVwZGF0ZWRBdF0pIHtcbiAgICAgIGluc3RhbmNlW3NjaGVtYS5vcHRpb25zLnRpbWVzdGFtcHMudXBkYXRlZEF0XSA9IHsgJGRiX2Z1bmN0aW9uOiAndG9UaW1lc3RhbXAobm93KCkpJyB9O1xuICAgIH1cbiAgfVxuXG4gIGlmIChzY2hlbWEub3B0aW9ucyAmJiBzY2hlbWEub3B0aW9ucy52ZXJzaW9ucykge1xuICAgIGlmIChpbnN0YW5jZVtzY2hlbWEub3B0aW9ucy52ZXJzaW9ucy5rZXldKSB7XG4gICAgICBpbnN0YW5jZVtzY2hlbWEub3B0aW9ucy52ZXJzaW9ucy5rZXldID0geyAkZGJfZnVuY3Rpb246ICdub3coKScgfTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBlcnJvckhhcHBlbmVkID0gT2JqZWN0LmtleXMoc2NoZW1hLmZpZWxkcykuc29tZSgoZmllbGROYW1lKSA9PiB7XG4gICAgaWYgKHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS52aXJ0dWFsKSByZXR1cm4gZmFsc2U7XG5cbiAgICAvLyBjaGVjayBmaWVsZCB2YWx1ZVxuICAgIGNvbnN0IGZpZWxkVHlwZSA9IHNjaGVtZXIuZ2V0X2ZpZWxkX3R5cGUoc2NoZW1hLCBmaWVsZE5hbWUpO1xuICAgIGxldCBmaWVsZFZhbHVlID0gaW5zdGFuY2VbZmllbGROYW1lXTtcblxuICAgIGlmIChmaWVsZFZhbHVlID09PSB1bmRlZmluZWQpIHtcbiAgICAgIGZpZWxkVmFsdWUgPSBpbnN0YW5jZS5fZ2V0X2RlZmF1bHRfdmFsdWUoZmllbGROYW1lKTtcbiAgICAgIGlmIChmaWVsZFZhbHVlID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcmV0dXJuIHBhcnNlci51bnNldF9ub3RfYWxsb3dlZCgnc2F2ZScsIHNjaGVtYSwgZmllbGROYW1lLCBjYWxsYmFjayk7XG4gICAgICB9IGVsc2UgaWYgKCFzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0ucnVsZSB8fCAhc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnJ1bGUuaWdub3JlX2RlZmF1bHQpIHtcbiAgICAgICAgLy8gZGlkIHNldCBhIGRlZmF1bHQgdmFsdWUsIGlnbm9yZSBkZWZhdWx0IGlzIG5vdCBzZXRcbiAgICAgICAgaWYgKGluc3RhbmNlLnZhbGlkYXRlKGZpZWxkTmFtZSwgZmllbGRWYWx1ZSkgIT09IHRydWUpIHtcbiAgICAgICAgICBwYXJzZXIuY2FsbGJhY2tfb3JfdGhyb3coYnVpbGRFcnJvcignbW9kZWwuc2F2ZS5pbnZhbGlkZGVmYXVsdHZhbHVlJywgZmllbGRWYWx1ZSwgZmllbGROYW1lLCBmaWVsZFR5cGUpLCBjYWxsYmFjayk7XG4gICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZmllbGRWYWx1ZSA9PT0gbnVsbCB8fCBmaWVsZFZhbHVlID09PSBjcWwudHlwZXMudW5zZXQpIHtcbiAgICAgIGlmIChwYXJzZXIudW5zZXRfbm90X2FsbG93ZWQoJ3NhdmUnLCBzY2hlbWEsIGZpZWxkTmFtZSwgY2FsbGJhY2spKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlkZW50aWZpZXJzLnB1c2godXRpbC5mb3JtYXQoJ1wiJXNcIicsIGZpZWxkTmFtZSkpO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGRiVmFsID0gcGFyc2VyLmdldF9kYl92YWx1ZV9leHByZXNzaW9uKHNjaGVtYSwgZmllbGROYW1lLCBmaWVsZFZhbHVlKTtcbiAgICAgIGlmIChfLmlzUGxhaW5PYmplY3QoZGJWYWwpICYmIGRiVmFsLnF1ZXJ5X3NlZ21lbnQpIHtcbiAgICAgICAgdmFsdWVzLnB1c2goZGJWYWwucXVlcnlfc2VnbWVudCk7XG4gICAgICAgIHF1ZXJ5UGFyYW1zLnB1c2goZGJWYWwucGFyYW1ldGVyKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZhbHVlcy5wdXNoKGRiVmFsKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBwYXJzZXIuY2FsbGJhY2tfb3JfdGhyb3coZSwgY2FsbGJhY2spO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfSk7XG5cbiAgcmV0dXJuIHtcbiAgICBpZGVudGlmaWVycyxcbiAgICB2YWx1ZXMsXG4gICAgcXVlcnlQYXJhbXMsXG4gICAgZXJyb3JIYXBwZW5lZCxcbiAgfTtcbn07XG5cbnBhcnNlci5leHRyYWN0X3F1ZXJ5X3JlbGF0aW9ucyA9IGZ1bmN0aW9uIGYoZmllbGROYW1lLCByZWxhdGlvbktleSwgcmVsYXRpb25WYWx1ZSwgc2NoZW1hLCB2YWxpZE9wZXJhdG9ycykge1xuICBjb25zdCBxdWVyeVJlbGF0aW9ucyA9IFtdO1xuICBjb25zdCBxdWVyeVBhcmFtcyA9IFtdO1xuXG4gIGlmICghXy5oYXModmFsaWRPcGVyYXRvcnMsIHJlbGF0aW9uS2V5LnRvTG93ZXJDYXNlKCkpKSB7XG4gICAgdGhyb3cgKGJ1aWxkRXJyb3IoJ21vZGVsLmZpbmQuaW52YWxpZG9wJywgcmVsYXRpb25LZXkpKTtcbiAgfVxuXG4gIHJlbGF0aW9uS2V5ID0gcmVsYXRpb25LZXkudG9Mb3dlckNhc2UoKTtcbiAgaWYgKHJlbGF0aW9uS2V5ID09PSAnJGluJyAmJiAhXy5pc0FycmF5KHJlbGF0aW9uVmFsdWUpKSB7XG4gICAgdGhyb3cgKGJ1aWxkRXJyb3IoJ21vZGVsLmZpbmQuaW52YWxpZGlub3AnKSk7XG4gIH1cbiAgaWYgKHJlbGF0aW9uS2V5ID09PSAnJHRva2VuJyAmJiAhKHJlbGF0aW9uVmFsdWUgaW5zdGFuY2VvZiBPYmplY3QpKSB7XG4gICAgdGhyb3cgKGJ1aWxkRXJyb3IoJ21vZGVsLmZpbmQuaW52YWxpZHRva2VuJykpO1xuICB9XG5cbiAgbGV0IG9wZXJhdG9yID0gdmFsaWRPcGVyYXRvcnNbcmVsYXRpb25LZXldO1xuICBsZXQgd2hlcmVUZW1wbGF0ZSA9ICdcIiVzXCIgJXMgJXMnO1xuXG4gIGNvbnN0IGJ1aWxkUXVlcnlSZWxhdGlvbnMgPSAoZmllbGROYW1lTG9jYWwsIHJlbGF0aW9uVmFsdWVMb2NhbCkgPT4ge1xuICAgIGNvbnN0IGRiVmFsID0gcGFyc2VyLmdldF9kYl92YWx1ZV9leHByZXNzaW9uKHNjaGVtYSwgZmllbGROYW1lTG9jYWwsIHJlbGF0aW9uVmFsdWVMb2NhbCk7XG4gICAgaWYgKF8uaXNQbGFpbk9iamVjdChkYlZhbCkgJiYgZGJWYWwucXVlcnlfc2VnbWVudCkge1xuICAgICAgcXVlcnlSZWxhdGlvbnMucHVzaCh1dGlsLmZvcm1hdChcbiAgICAgICAgd2hlcmVUZW1wbGF0ZSxcbiAgICAgICAgZmllbGROYW1lTG9jYWwsIG9wZXJhdG9yLCBkYlZhbC5xdWVyeV9zZWdtZW50LFxuICAgICAgKSk7XG4gICAgICBxdWVyeVBhcmFtcy5wdXNoKGRiVmFsLnBhcmFtZXRlcik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHF1ZXJ5UmVsYXRpb25zLnB1c2godXRpbC5mb3JtYXQoXG4gICAgICAgIHdoZXJlVGVtcGxhdGUsXG4gICAgICAgIGZpZWxkTmFtZUxvY2FsLCBvcGVyYXRvciwgZGJWYWwsXG4gICAgICApKTtcbiAgICB9XG4gIH07XG5cbiAgY29uc3QgYnVpbGRUb2tlblF1ZXJ5UmVsYXRpb25zID0gKHRva2VuUmVsYXRpb25LZXksIHRva2VuUmVsYXRpb25WYWx1ZSkgPT4ge1xuICAgIHRva2VuUmVsYXRpb25LZXkgPSB0b2tlblJlbGF0aW9uS2V5LnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKF8uaGFzKHZhbGlkT3BlcmF0b3JzLCB0b2tlblJlbGF0aW9uS2V5KSAmJiB0b2tlblJlbGF0aW9uS2V5ICE9PSAnJHRva2VuJyAmJiB0b2tlblJlbGF0aW9uS2V5ICE9PSAnJGluJykge1xuICAgICAgb3BlcmF0b3IgPSB2YWxpZE9wZXJhdG9yc1t0b2tlblJlbGF0aW9uS2V5XTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgKGJ1aWxkRXJyb3IoJ21vZGVsLmZpbmQuaW52YWxpZHRva2Vub3AnLCB0b2tlblJlbGF0aW9uS2V5KSk7XG4gICAgfVxuXG4gICAgaWYgKF8uaXNBcnJheSh0b2tlblJlbGF0aW9uVmFsdWUpKSB7XG4gICAgICBjb25zdCB0b2tlbktleXMgPSBmaWVsZE5hbWUuc3BsaXQoJywnKTtcbiAgICAgIGZvciAobGV0IHRva2VuSW5kZXggPSAwOyB0b2tlbkluZGV4IDwgdG9rZW5SZWxhdGlvblZhbHVlLmxlbmd0aDsgdG9rZW5JbmRleCsrKSB7XG4gICAgICAgIHRva2VuS2V5c1t0b2tlbkluZGV4XSA9IHRva2VuS2V5c1t0b2tlbkluZGV4XS50cmltKCk7XG4gICAgICAgIGNvbnN0IGRiVmFsID0gcGFyc2VyLmdldF9kYl92YWx1ZV9leHByZXNzaW9uKHNjaGVtYSwgdG9rZW5LZXlzW3Rva2VuSW5kZXhdLCB0b2tlblJlbGF0aW9uVmFsdWVbdG9rZW5JbmRleF0pO1xuICAgICAgICBpZiAoXy5pc1BsYWluT2JqZWN0KGRiVmFsKSAmJiBkYlZhbC5xdWVyeV9zZWdtZW50KSB7XG4gICAgICAgICAgdG9rZW5SZWxhdGlvblZhbHVlW3Rva2VuSW5kZXhdID0gZGJWYWwucXVlcnlfc2VnbWVudDtcbiAgICAgICAgICBxdWVyeVBhcmFtcy5wdXNoKGRiVmFsLnBhcmFtZXRlcik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdG9rZW5SZWxhdGlvblZhbHVlW3Rva2VuSW5kZXhdID0gZGJWYWw7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHF1ZXJ5UmVsYXRpb25zLnB1c2godXRpbC5mb3JtYXQoXG4gICAgICAgIHdoZXJlVGVtcGxhdGUsXG4gICAgICAgIHRva2VuS2V5cy5qb2luKCdcIixcIicpLCBvcGVyYXRvciwgdG9rZW5SZWxhdGlvblZhbHVlLnRvU3RyaW5nKCksXG4gICAgICApKTtcbiAgICB9IGVsc2Uge1xuICAgICAgYnVpbGRRdWVyeVJlbGF0aW9ucyhmaWVsZE5hbWUsIHRva2VuUmVsYXRpb25WYWx1ZSk7XG4gICAgfVxuICB9O1xuXG4gIGlmIChyZWxhdGlvbktleSA9PT0gJyR0b2tlbicpIHtcbiAgICB3aGVyZVRlbXBsYXRlID0gJ3Rva2VuKFwiJXNcIikgJXMgdG9rZW4oJXMpJztcblxuICAgIGNvbnN0IHRva2VuUmVsYXRpb25LZXlzID0gT2JqZWN0LmtleXMocmVsYXRpb25WYWx1ZSk7XG4gICAgZm9yIChsZXQgdG9rZW5SSyA9IDA7IHRva2VuUksgPCB0b2tlblJlbGF0aW9uS2V5cy5sZW5ndGg7IHRva2VuUksrKykge1xuICAgICAgY29uc3QgdG9rZW5SZWxhdGlvbktleSA9IHRva2VuUmVsYXRpb25LZXlzW3Rva2VuUktdO1xuICAgICAgY29uc3QgdG9rZW5SZWxhdGlvblZhbHVlID0gcmVsYXRpb25WYWx1ZVt0b2tlblJlbGF0aW9uS2V5XTtcbiAgICAgIGJ1aWxkVG9rZW5RdWVyeVJlbGF0aW9ucyh0b2tlblJlbGF0aW9uS2V5LCB0b2tlblJlbGF0aW9uVmFsdWUpO1xuICAgIH1cbiAgfSBlbHNlIGlmIChyZWxhdGlvbktleSA9PT0gJyRjb250YWlucycpIHtcbiAgICBjb25zdCBmaWVsZFR5cGUxID0gc2NoZW1lci5nZXRfZmllbGRfdHlwZShzY2hlbWEsIGZpZWxkTmFtZSk7XG4gICAgaWYgKFsnbWFwJywgJ2xpc3QnLCAnc2V0JywgJ2Zyb3plbiddLmluY2x1ZGVzKGZpZWxkVHlwZTEpKSB7XG4gICAgICBpZiAoZmllbGRUeXBlMSA9PT0gJ21hcCcgJiYgXy5pc1BsYWluT2JqZWN0KHJlbGF0aW9uVmFsdWUpKSB7XG4gICAgICAgIE9iamVjdC5rZXlzKHJlbGF0aW9uVmFsdWUpLmZvckVhY2goKGtleSkgPT4ge1xuICAgICAgICAgIHF1ZXJ5UmVsYXRpb25zLnB1c2godXRpbC5mb3JtYXQoXG4gICAgICAgICAgICAnXCIlc1wiWyVzXSAlcyAlcycsXG4gICAgICAgICAgICBmaWVsZE5hbWUsICc/JywgJz0nLCAnPycsXG4gICAgICAgICAgKSk7XG4gICAgICAgICAgcXVlcnlQYXJhbXMucHVzaChrZXkpO1xuICAgICAgICAgIHF1ZXJ5UGFyYW1zLnB1c2gocmVsYXRpb25WYWx1ZVtrZXldKTtcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBxdWVyeVJlbGF0aW9ucy5wdXNoKHV0aWwuZm9ybWF0KFxuICAgICAgICAgIHdoZXJlVGVtcGxhdGUsXG4gICAgICAgICAgZmllbGROYW1lLCBvcGVyYXRvciwgJz8nLFxuICAgICAgICApKTtcbiAgICAgICAgcXVlcnlQYXJhbXMucHVzaChyZWxhdGlvblZhbHVlKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgKGJ1aWxkRXJyb3IoJ21vZGVsLmZpbmQuaW52YWxpZGNvbnRhaW5zb3AnKSk7XG4gICAgfVxuICB9IGVsc2UgaWYgKHJlbGF0aW9uS2V5ID09PSAnJGNvbnRhaW5zX2tleScpIHtcbiAgICBjb25zdCBmaWVsZFR5cGUyID0gc2NoZW1lci5nZXRfZmllbGRfdHlwZShzY2hlbWEsIGZpZWxkTmFtZSk7XG4gICAgaWYgKGZpZWxkVHlwZTIgIT09ICdtYXAnKSB7XG4gICAgICB0aHJvdyAoYnVpbGRFcnJvcignbW9kZWwuZmluZC5pbnZhbGlkY29udGFpbnNrZXlvcCcpKTtcbiAgICB9XG4gICAgcXVlcnlSZWxhdGlvbnMucHVzaCh1dGlsLmZvcm1hdChcbiAgICAgIHdoZXJlVGVtcGxhdGUsXG4gICAgICBmaWVsZE5hbWUsIG9wZXJhdG9yLCAnPycsXG4gICAgKSk7XG4gICAgcXVlcnlQYXJhbXMucHVzaChyZWxhdGlvblZhbHVlKTtcbiAgfSBlbHNlIHtcbiAgICBidWlsZFF1ZXJ5UmVsYXRpb25zKGZpZWxkTmFtZSwgcmVsYXRpb25WYWx1ZSk7XG4gIH1cbiAgcmV0dXJuIHsgcXVlcnlSZWxhdGlvbnMsIHF1ZXJ5UGFyYW1zIH07XG59O1xuXG5wYXJzZXIuX3BhcnNlX3F1ZXJ5X29iamVjdCA9IGZ1bmN0aW9uIGYoc2NoZW1hLCBxdWVyeU9iamVjdCkge1xuICBsZXQgcXVlcnlSZWxhdGlvbnMgPSBbXTtcbiAgbGV0IHF1ZXJ5UGFyYW1zID0gW107XG5cbiAgT2JqZWN0LmtleXMocXVlcnlPYmplY3QpLmZvckVhY2goKGZpZWxkTmFtZSkgPT4ge1xuICAgIGlmIChmaWVsZE5hbWUuc3RhcnRzV2l0aCgnJCcpKSB7XG4gICAgICAvLyBzZWFyY2ggcXVlcmllcyBiYXNlZCBvbiBsdWNlbmUgaW5kZXggb3Igc29sclxuICAgICAgLy8gZXNjYXBlIGFsbCBzaW5nbGUgcXVvdGVzIGZvciBxdWVyaWVzIGluIGNhc3NhbmRyYVxuICAgICAgaWYgKGZpZWxkTmFtZSA9PT0gJyRleHByJykge1xuICAgICAgICBpZiAodHlwZW9mIHF1ZXJ5T2JqZWN0W2ZpZWxkTmFtZV0uaW5kZXggPT09ICdzdHJpbmcnICYmIHR5cGVvZiBxdWVyeU9iamVjdFtmaWVsZE5hbWVdLnF1ZXJ5ID09PSAnc3RyaW5nJykge1xuICAgICAgICAgIHF1ZXJ5UmVsYXRpb25zLnB1c2godXRpbC5mb3JtYXQoXG4gICAgICAgICAgICBcImV4cHIoJXMsJyVzJylcIixcbiAgICAgICAgICAgIHF1ZXJ5T2JqZWN0W2ZpZWxkTmFtZV0uaW5kZXgsIHF1ZXJ5T2JqZWN0W2ZpZWxkTmFtZV0ucXVlcnkucmVwbGFjZSgvJy9nLCBcIicnXCIpLFxuICAgICAgICAgICkpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IChidWlsZEVycm9yKCdtb2RlbC5maW5kLmludmFsaWRleHByJykpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkTmFtZSA9PT0gJyRzb2xyX3F1ZXJ5Jykge1xuICAgICAgICBpZiAodHlwZW9mIHF1ZXJ5T2JqZWN0W2ZpZWxkTmFtZV0gPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgcXVlcnlSZWxhdGlvbnMucHVzaCh1dGlsLmZvcm1hdChcbiAgICAgICAgICAgIFwic29scl9xdWVyeT0nJXMnXCIsXG4gICAgICAgICAgICBxdWVyeU9iamVjdFtmaWVsZE5hbWVdLnJlcGxhY2UoLycvZywgXCInJ1wiKSxcbiAgICAgICAgICApKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyAoYnVpbGRFcnJvcignbW9kZWwuZmluZC5pbnZhbGlkc29scnF1ZXJ5JykpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgbGV0IHdoZXJlT2JqZWN0ID0gcXVlcnlPYmplY3RbZmllbGROYW1lXTtcbiAgICAvLyBBcnJheSBvZiBvcGVyYXRvcnNcbiAgICBpZiAoIV8uaXNBcnJheSh3aGVyZU9iamVjdCkpIHdoZXJlT2JqZWN0ID0gW3doZXJlT2JqZWN0XTtcblxuICAgIGZvciAobGV0IGZrID0gMDsgZmsgPCB3aGVyZU9iamVjdC5sZW5ndGg7IGZrKyspIHtcbiAgICAgIGxldCBmaWVsZFJlbGF0aW9uID0gd2hlcmVPYmplY3RbZmtdO1xuXG4gICAgICBjb25zdCBjcWxPcGVyYXRvcnMgPSB7XG4gICAgICAgICRlcTogJz0nLFxuICAgICAgICAkbmU6ICchPScsXG4gICAgICAgICRpc250OiAnSVMgTk9UJyxcbiAgICAgICAgJGd0OiAnPicsXG4gICAgICAgICRsdDogJzwnLFxuICAgICAgICAkZ3RlOiAnPj0nLFxuICAgICAgICAkbHRlOiAnPD0nLFxuICAgICAgICAkaW46ICdJTicsXG4gICAgICAgICRsaWtlOiAnTElLRScsXG4gICAgICAgICR0b2tlbjogJ3Rva2VuJyxcbiAgICAgICAgJGNvbnRhaW5zOiAnQ09OVEFJTlMnLFxuICAgICAgICAkY29udGFpbnNfa2V5OiAnQ09OVEFJTlMgS0VZJyxcbiAgICAgIH07XG5cbiAgICAgIGlmIChfLmlzUGxhaW5PYmplY3QoZmllbGRSZWxhdGlvbikpIHtcbiAgICAgICAgY29uc3QgdmFsaWRLZXlzID0gT2JqZWN0LmtleXMoY3FsT3BlcmF0b3JzKTtcbiAgICAgICAgY29uc3QgZmllbGRSZWxhdGlvbktleXMgPSBPYmplY3Qua2V5cyhmaWVsZFJlbGF0aW9uKTtcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBmaWVsZFJlbGF0aW9uS2V5cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgIGlmICghdmFsaWRLZXlzLmluY2x1ZGVzKGZpZWxkUmVsYXRpb25LZXlzW2ldKSkge1xuICAgICAgICAgICAgLy8gZmllbGQgcmVsYXRpb24ga2V5IGludmFsaWQsIGFwcGx5IGRlZmF1bHQgJGVxIG9wZXJhdG9yXG4gICAgICAgICAgICBmaWVsZFJlbGF0aW9uID0geyAkZXE6IGZpZWxkUmVsYXRpb24gfTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZmllbGRSZWxhdGlvbiA9IHsgJGVxOiBmaWVsZFJlbGF0aW9uIH07XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlbGF0aW9uS2V5cyA9IE9iamVjdC5rZXlzKGZpZWxkUmVsYXRpb24pO1xuICAgICAgZm9yIChsZXQgcmsgPSAwOyByayA8IHJlbGF0aW9uS2V5cy5sZW5ndGg7IHJrKyspIHtcbiAgICAgICAgY29uc3QgcmVsYXRpb25LZXkgPSByZWxhdGlvbktleXNbcmtdO1xuICAgICAgICBjb25zdCByZWxhdGlvblZhbHVlID0gZmllbGRSZWxhdGlvbltyZWxhdGlvbktleV07XG4gICAgICAgIGNvbnN0IGV4dHJhY3RlZFJlbGF0aW9ucyA9IHBhcnNlci5leHRyYWN0X3F1ZXJ5X3JlbGF0aW9ucyhcbiAgICAgICAgICBmaWVsZE5hbWUsXG4gICAgICAgICAgcmVsYXRpb25LZXksXG4gICAgICAgICAgcmVsYXRpb25WYWx1ZSxcbiAgICAgICAgICBzY2hlbWEsXG4gICAgICAgICAgY3FsT3BlcmF0b3JzLFxuICAgICAgICApO1xuICAgICAgICBxdWVyeVJlbGF0aW9ucyA9IHF1ZXJ5UmVsYXRpb25zLmNvbmNhdChleHRyYWN0ZWRSZWxhdGlvbnMucXVlcnlSZWxhdGlvbnMpO1xuICAgICAgICBxdWVyeVBhcmFtcyA9IHF1ZXJ5UGFyYW1zLmNvbmNhdChleHRyYWN0ZWRSZWxhdGlvbnMucXVlcnlQYXJhbXMpO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG5cbiAgcmV0dXJuIHsgcXVlcnlSZWxhdGlvbnMsIHF1ZXJ5UGFyYW1zIH07XG59O1xuXG5wYXJzZXIuZ2V0X2ZpbHRlcl9jbGF1c2UgPSBmdW5jdGlvbiBmKHNjaGVtYSwgcXVlcnlPYmplY3QsIGNsYXVzZSkge1xuICBjb25zdCBwYXJzZWRPYmplY3QgPSBwYXJzZXIuX3BhcnNlX3F1ZXJ5X29iamVjdChzY2hlbWEsIHF1ZXJ5T2JqZWN0KTtcbiAgY29uc3QgZmlsdGVyQ2xhdXNlID0ge307XG4gIGlmIChwYXJzZWRPYmplY3QucXVlcnlSZWxhdGlvbnMubGVuZ3RoID4gMCkge1xuICAgIGZpbHRlckNsYXVzZS5xdWVyeSA9IHV0aWwuZm9ybWF0KCclcyAlcycsIGNsYXVzZSwgcGFyc2VkT2JqZWN0LnF1ZXJ5UmVsYXRpb25zLmpvaW4oJyBBTkQgJykpO1xuICB9IGVsc2Uge1xuICAgIGZpbHRlckNsYXVzZS5xdWVyeSA9ICcnO1xuICB9XG4gIGZpbHRlckNsYXVzZS5wYXJhbXMgPSBwYXJzZWRPYmplY3QucXVlcnlQYXJhbXM7XG4gIHJldHVybiBmaWx0ZXJDbGF1c2U7XG59O1xuXG5wYXJzZXIuZ2V0X2ZpbHRlcl9jbGF1c2VfZGRsID0gZnVuY3Rpb24gZihzY2hlbWEsIHF1ZXJ5T2JqZWN0LCBjbGF1c2UpIHtcbiAgY29uc3QgZmlsdGVyQ2xhdXNlID0gcGFyc2VyLmdldF9maWx0ZXJfY2xhdXNlKHNjaGVtYSwgcXVlcnlPYmplY3QsIGNsYXVzZSk7XG4gIGxldCBmaWx0ZXJRdWVyeSA9IGZpbHRlckNsYXVzZS5xdWVyeTtcbiAgZmlsdGVyQ2xhdXNlLnBhcmFtcy5mb3JFYWNoKChwYXJhbSkgPT4ge1xuICAgIGxldCBxdWVyeVBhcmFtO1xuICAgIGlmICh0eXBlb2YgcGFyYW0gPT09ICdzdHJpbmcnKSB7XG4gICAgICBxdWVyeVBhcmFtID0gdXRpbC5mb3JtYXQoXCInJXMnXCIsIHBhcmFtKTtcbiAgICB9IGVsc2UgaWYgKHBhcmFtIGluc3RhbmNlb2YgRGF0ZSkge1xuICAgICAgcXVlcnlQYXJhbSA9IHV0aWwuZm9ybWF0KFwiJyVzJ1wiLCBwYXJhbS50b0lTT1N0cmluZygpKTtcbiAgICB9IGVsc2UgaWYgKHBhcmFtIGluc3RhbmNlb2YgY3FsLnR5cGVzLkxvbmdcbiAgICAgIHx8IHBhcmFtIGluc3RhbmNlb2YgY3FsLnR5cGVzLkludGVnZXJcbiAgICAgIHx8IHBhcmFtIGluc3RhbmNlb2YgY3FsLnR5cGVzLkJpZ0RlY2ltYWxcbiAgICAgIHx8IHBhcmFtIGluc3RhbmNlb2YgY3FsLnR5cGVzLlRpbWVVdWlkXG4gICAgICB8fCBwYXJhbSBpbnN0YW5jZW9mIGNxbC50eXBlcy5VdWlkKSB7XG4gICAgICBxdWVyeVBhcmFtID0gcGFyYW0udG9TdHJpbmcoKTtcbiAgICB9IGVsc2UgaWYgKHBhcmFtIGluc3RhbmNlb2YgY3FsLnR5cGVzLkxvY2FsRGF0ZVxuICAgICAgfHwgcGFyYW0gaW5zdGFuY2VvZiBjcWwudHlwZXMuTG9jYWxUaW1lXG4gICAgICB8fCBwYXJhbSBpbnN0YW5jZW9mIGNxbC50eXBlcy5JbmV0QWRkcmVzcykge1xuICAgICAgcXVlcnlQYXJhbSA9IHV0aWwuZm9ybWF0KFwiJyVzJ1wiLCBwYXJhbS50b1N0cmluZygpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcXVlcnlQYXJhbSA9IHBhcmFtO1xuICAgIH1cbiAgICAvLyBUT0RPOiB1bmhhbmRsZWQgaWYgcXVlcnlQYXJhbSBpcyBhIHN0cmluZyBjb250YWluaW5nID8gY2hhcmFjdGVyXG4gICAgLy8gdGhvdWdoIHRoaXMgaXMgdW5saWtlbHkgdG8gaGF2ZSBpbiBtYXRlcmlhbGl6ZWQgdmlldyBmaWx0ZXJzLCBidXQuLi5cbiAgICBmaWx0ZXJRdWVyeSA9IGZpbHRlclF1ZXJ5LnJlcGxhY2UoJz8nLCBxdWVyeVBhcmFtKTtcbiAgfSk7XG4gIHJldHVybiBmaWx0ZXJRdWVyeTtcbn07XG5cbnBhcnNlci5nZXRfd2hlcmVfY2xhdXNlID0gZnVuY3Rpb24gZihzY2hlbWEsIHF1ZXJ5T2JqZWN0KSB7XG4gIHJldHVybiBwYXJzZXIuZ2V0X2ZpbHRlcl9jbGF1c2Uoc2NoZW1hLCBxdWVyeU9iamVjdCwgJ1dIRVJFJyk7XG59O1xuXG5wYXJzZXIuZ2V0X2lmX2NsYXVzZSA9IGZ1bmN0aW9uIGYoc2NoZW1hLCBxdWVyeU9iamVjdCkge1xuICByZXR1cm4gcGFyc2VyLmdldF9maWx0ZXJfY2xhdXNlKHNjaGVtYSwgcXVlcnlPYmplY3QsICdJRicpO1xufTtcblxucGFyc2VyLmdldF9wcmltYXJ5X2tleV9jbGF1c2VzID0gZnVuY3Rpb24gZihzY2hlbWEpIHtcbiAgY29uc3QgcGFydGl0aW9uS2V5ID0gc2NoZW1hLmtleVswXTtcbiAgbGV0IGNsdXN0ZXJpbmdLZXkgPSBzY2hlbWEua2V5LnNsaWNlKDEsIHNjaGVtYS5rZXkubGVuZ3RoKTtcbiAgY29uc3QgY2x1c3RlcmluZ09yZGVyID0gW107XG5cbiAgZm9yIChsZXQgZmllbGQgPSAwOyBmaWVsZCA8IGNsdXN0ZXJpbmdLZXkubGVuZ3RoOyBmaWVsZCsrKSB7XG4gICAgaWYgKHNjaGVtYS5jbHVzdGVyaW5nX29yZGVyXG4gICAgICAgICYmIHNjaGVtYS5jbHVzdGVyaW5nX29yZGVyW2NsdXN0ZXJpbmdLZXlbZmllbGRdXVxuICAgICAgICAmJiBzY2hlbWEuY2x1c3RlcmluZ19vcmRlcltjbHVzdGVyaW5nS2V5W2ZpZWxkXV0udG9Mb3dlckNhc2UoKSA9PT0gJ2Rlc2MnKSB7XG4gICAgICBjbHVzdGVyaW5nT3JkZXIucHVzaCh1dGlsLmZvcm1hdCgnXCIlc1wiIERFU0MnLCBjbHVzdGVyaW5nS2V5W2ZpZWxkXSkpO1xuICAgIH0gZWxzZSB7XG4gICAgICBjbHVzdGVyaW5nT3JkZXIucHVzaCh1dGlsLmZvcm1hdCgnXCIlc1wiIEFTQycsIGNsdXN0ZXJpbmdLZXlbZmllbGRdKSk7XG4gICAgfVxuICB9XG5cbiAgbGV0IGNsdXN0ZXJpbmdPcmRlckNsYXVzZSA9ICcnO1xuICBpZiAoY2x1c3RlcmluZ09yZGVyLmxlbmd0aCA+IDApIHtcbiAgICBjbHVzdGVyaW5nT3JkZXJDbGF1c2UgPSB1dGlsLmZvcm1hdCgnIFdJVEggQ0xVU1RFUklORyBPUkRFUiBCWSAoJXMpJywgY2x1c3RlcmluZ09yZGVyLnRvU3RyaW5nKCkpO1xuICB9XG5cbiAgbGV0IHBhcnRpdGlvbktleUNsYXVzZSA9ICcnO1xuICBpZiAoXy5pc0FycmF5KHBhcnRpdGlvbktleSkpIHtcbiAgICBwYXJ0aXRpb25LZXlDbGF1c2UgPSBwYXJ0aXRpb25LZXkubWFwKCh2KSA9PiB1dGlsLmZvcm1hdCgnXCIlc1wiJywgdikpLmpvaW4oJywnKTtcbiAgfSBlbHNlIHtcbiAgICBwYXJ0aXRpb25LZXlDbGF1c2UgPSB1dGlsLmZvcm1hdCgnXCIlc1wiJywgcGFydGl0aW9uS2V5KTtcbiAgfVxuXG4gIGxldCBjbHVzdGVyaW5nS2V5Q2xhdXNlID0gJyc7XG4gIGlmIChjbHVzdGVyaW5nS2V5Lmxlbmd0aCkge1xuICAgIGNsdXN0ZXJpbmdLZXkgPSBjbHVzdGVyaW5nS2V5Lm1hcCgodikgPT4gdXRpbC5mb3JtYXQoJ1wiJXNcIicsIHYpKS5qb2luKCcsJyk7XG4gICAgY2x1c3RlcmluZ0tleUNsYXVzZSA9IHV0aWwuZm9ybWF0KCcsJXMnLCBjbHVzdGVyaW5nS2V5KTtcbiAgfVxuXG4gIHJldHVybiB7IHBhcnRpdGlvbktleUNsYXVzZSwgY2x1c3RlcmluZ0tleUNsYXVzZSwgY2x1c3RlcmluZ09yZGVyQ2xhdXNlIH07XG59O1xuXG5wYXJzZXIuZ2V0X212aWV3X3doZXJlX2NsYXVzZSA9IGZ1bmN0aW9uIGYoc2NoZW1hLCB2aWV3U2NoZW1hKSB7XG4gIGNvbnN0IGNsYXVzZXMgPSBwYXJzZXIuZ2V0X3ByaW1hcnlfa2V5X2NsYXVzZXModmlld1NjaGVtYSk7XG4gIGxldCB3aGVyZUNsYXVzZSA9IGNsYXVzZXMucGFydGl0aW9uS2V5Q2xhdXNlLnNwbGl0KCcsJykuam9pbignIElTIE5PVCBOVUxMIEFORCAnKTtcbiAgaWYgKGNsYXVzZXMuY2x1c3RlcmluZ0tleUNsYXVzZSkgd2hlcmVDbGF1c2UgKz0gY2xhdXNlcy5jbHVzdGVyaW5nS2V5Q2xhdXNlLnNwbGl0KCcsJykuam9pbignIElTIE5PVCBOVUxMIEFORCAnKTtcbiAgd2hlcmVDbGF1c2UgKz0gJyBJUyBOT1QgTlVMTCc7XG5cbiAgY29uc3QgZmlsdGVycyA9IF8uY2xvbmVEZWVwKHZpZXdTY2hlbWEuZmlsdGVycyk7XG5cbiAgaWYgKF8uaXNQbGFpbk9iamVjdChmaWx0ZXJzKSkge1xuICAgIC8vIGRlbGV0ZSBwcmltYXJ5IGtleSBmaWVsZHMgZGVmaW5lZCBhcyBpc24ndCBudWxsIGluIGZpbHRlcnNcbiAgICBPYmplY3Qua2V5cyhmaWx0ZXJzKS5mb3JFYWNoKChmaWx0ZXJLZXkpID0+IHtcbiAgICAgIGlmIChmaWx0ZXJzW2ZpbHRlcktleV0uJGlzbnQgPT09IG51bGxcbiAgICAgICAgICAmJiAodmlld1NjaGVtYS5rZXkuaW5jbHVkZXMoZmlsdGVyS2V5KSB8fCB2aWV3U2NoZW1hLmtleVswXS5pbmNsdWRlcyhmaWx0ZXJLZXkpKSkge1xuICAgICAgICBkZWxldGUgZmlsdGVyc1tmaWx0ZXJLZXldLiRpc250O1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgZmlsdGVyQ2xhdXNlID0gcGFyc2VyLmdldF9maWx0ZXJfY2xhdXNlX2RkbChzY2hlbWEsIGZpbHRlcnMsICdBTkQnKTtcbiAgICB3aGVyZUNsYXVzZSArPSB1dGlsLmZvcm1hdCgnICVzJywgZmlsdGVyQ2xhdXNlKS5yZXBsYWNlKC9JUyBOT1QgbnVsbC9nLCAnSVMgTk9UIE5VTEwnKTtcbiAgfVxuXG4gIC8vIHJlbW92ZSB1bm5lY2Vzc2FyaWx5IHF1b3RlZCBmaWVsZCBuYW1lcyBpbiBnZW5lcmF0ZWQgd2hlcmUgY2xhdXNlXG4gIC8vIHNvIHRoYXQgaXQgbWF0Y2hlcyB0aGUgd2hlcmVfY2xhdXNlIGZyb20gZGF0YWJhc2Ugc2NoZW1hXG4gIGNvbnN0IHF1b3RlZEZpZWxkTmFtZXMgPSB3aGVyZUNsYXVzZS5tYXRjaCgvXCIoLio/KVwiL2cpO1xuICBxdW90ZWRGaWVsZE5hbWVzLmZvckVhY2goKGZpZWxkTmFtZSkgPT4ge1xuICAgIGNvbnN0IHVucXVvdGVkRmllbGROYW1lID0gZmllbGROYW1lLnJlcGxhY2UoL1wiL2csICcnKTtcbiAgICBjb25zdCByZXNlcnZlZEtleXdvcmRzID0gW1xuICAgICAgJ0FERCcsICdBR0dSRUdBVEUnLCAnQUxMT1cnLCAnQUxURVInLCAnQU5EJywgJ0FOWScsICdBUFBMWScsXG4gICAgICAnQVNDJywgJ0FVVEhPUklaRScsICdCQVRDSCcsICdCRUdJTicsICdCWScsICdDT0xVTU5GQU1JTFknLFxuICAgICAgJ0NSRUFURScsICdERUxFVEUnLCAnREVTQycsICdEUk9QJywgJ0VBQ0hfUVVPUlVNJywgJ0VOVFJJRVMnLFxuICAgICAgJ0ZST00nLCAnRlVMTCcsICdHUkFOVCcsICdJRicsICdJTicsICdJTkRFWCcsICdJTkVUJywgJ0lORklOSVRZJyxcbiAgICAgICdJTlNFUlQnLCAnSU5UTycsICdLRVlTUEFDRScsICdLRVlTUEFDRVMnLCAnTElNSVQnLCAnTE9DQUxfT05FJyxcbiAgICAgICdMT0NBTF9RVU9SVU0nLCAnTUFURVJJQUxJWkVEJywgJ01PRElGWScsICdOQU4nLCAnTk9SRUNVUlNJVkUnLFxuICAgICAgJ05PVCcsICdPRicsICdPTicsICdPTkUnLCAnT1JERVInLCAnUEFSVElUSU9OJywgJ1BBU1NXT1JEJywgJ1BFUicsXG4gICAgICAnUFJJTUFSWScsICdRVU9SVU0nLCAnUkVOQU1FJywgJ1JFVk9LRScsICdTQ0hFTUEnLCAnU0VMRUNUJywgJ1NFVCcsXG4gICAgICAnVEFCTEUnLCAnVElNRScsICdUSFJFRScsICdUTycsICdUT0tFTicsICdUUlVOQ0FURScsICdUV08nLCAnVU5MT0dHRUQnLFxuICAgICAgJ1VQREFURScsICdVU0UnLCAnVVNJTkcnLCAnVklFVycsICdXSEVSRScsICdXSVRIJ107XG4gICAgaWYgKHVucXVvdGVkRmllbGROYW1lID09PSB1bnF1b3RlZEZpZWxkTmFtZS50b0xvd2VyQ2FzZSgpXG4gICAgICAmJiAhcmVzZXJ2ZWRLZXl3b3Jkcy5pbmNsdWRlcyh1bnF1b3RlZEZpZWxkTmFtZS50b1VwcGVyQ2FzZSgpKSkge1xuICAgICAgd2hlcmVDbGF1c2UgPSB3aGVyZUNsYXVzZS5yZXBsYWNlKGZpZWxkTmFtZSwgdW5xdW90ZWRGaWVsZE5hbWUpO1xuICAgIH1cbiAgfSk7XG4gIHJldHVybiB3aGVyZUNsYXVzZS50cmltKCk7XG59O1xuXG5wYXJzZXIuZ2V0X29yZGVyYnlfY2xhdXNlID0gZnVuY3Rpb24gZihxdWVyeU9iamVjdCkge1xuICBjb25zdCBvcmRlcktleXMgPSBbXTtcbiAgT2JqZWN0LmtleXMocXVlcnlPYmplY3QpLmZvckVhY2goKGspID0+IHtcbiAgICBjb25zdCBxdWVyeUl0ZW0gPSBxdWVyeU9iamVjdFtrXTtcbiAgICBpZiAoay50b0xvd2VyQ2FzZSgpID09PSAnJG9yZGVyYnknKSB7XG4gICAgICBpZiAoIShxdWVyeUl0ZW0gaW5zdGFuY2VvZiBPYmplY3QpKSB7XG4gICAgICAgIHRocm93IChidWlsZEVycm9yKCdtb2RlbC5maW5kLmludmFsaWRvcmRlcicpKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IG9yZGVySXRlbUtleXMgPSBPYmplY3Qua2V5cyhxdWVyeUl0ZW0pO1xuXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IG9yZGVySXRlbUtleXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgY29uc3QgY3FsT3JkZXJEaXJlY3Rpb24gPSB7ICRhc2M6ICdBU0MnLCAkZGVzYzogJ0RFU0MnIH07XG4gICAgICAgIGlmIChvcmRlckl0ZW1LZXlzW2ldLnRvTG93ZXJDYXNlKCkgaW4gY3FsT3JkZXJEaXJlY3Rpb24pIHtcbiAgICAgICAgICBsZXQgb3JkZXJGaWVsZHMgPSBxdWVyeUl0ZW1bb3JkZXJJdGVtS2V5c1tpXV07XG5cbiAgICAgICAgICBpZiAoIV8uaXNBcnJheShvcmRlckZpZWxkcykpIHtcbiAgICAgICAgICAgIG9yZGVyRmllbGRzID0gW29yZGVyRmllbGRzXTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBmb3IgKGxldCBqID0gMDsgaiA8IG9yZGVyRmllbGRzLmxlbmd0aDsgaisrKSB7XG4gICAgICAgICAgICBvcmRlcktleXMucHVzaCh1dGlsLmZvcm1hdChcbiAgICAgICAgICAgICAgJ1wiJXNcIiAlcycsXG4gICAgICAgICAgICAgIG9yZGVyRmllbGRzW2pdLCBjcWxPcmRlckRpcmVjdGlvbltvcmRlckl0ZW1LZXlzW2ldXSxcbiAgICAgICAgICAgICkpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyAoYnVpbGRFcnJvcignbW9kZWwuZmluZC5pbnZhbGlkb3JkZXJ0eXBlJywgb3JkZXJJdGVtS2V5c1tpXSkpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9KTtcbiAgcmV0dXJuIG9yZGVyS2V5cy5sZW5ndGggPyB1dGlsLmZvcm1hdCgnT1JERVIgQlkgJXMnLCBvcmRlcktleXMuam9pbignLCAnKSkgOiAnJztcbn07XG5cbnBhcnNlci5nZXRfZ3JvdXBieV9jbGF1c2UgPSBmdW5jdGlvbiBmKHF1ZXJ5T2JqZWN0KSB7XG4gIGxldCBncm91cGJ5S2V5cyA9IFtdO1xuXG4gIE9iamVjdC5rZXlzKHF1ZXJ5T2JqZWN0KS5mb3JFYWNoKChrKSA9PiB7XG4gICAgY29uc3QgcXVlcnlJdGVtID0gcXVlcnlPYmplY3Rba107XG5cbiAgICBpZiAoay50b0xvd2VyQ2FzZSgpID09PSAnJGdyb3VwYnknKSB7XG4gICAgICBpZiAoIShxdWVyeUl0ZW0gaW5zdGFuY2VvZiBBcnJheSkpIHtcbiAgICAgICAgdGhyb3cgKGJ1aWxkRXJyb3IoJ21vZGVsLmZpbmQuaW52YWxpZGdyb3VwJykpO1xuICAgICAgfVxuXG4gICAgICBncm91cGJ5S2V5cyA9IGdyb3VwYnlLZXlzLmNvbmNhdChxdWVyeUl0ZW0pO1xuICAgIH1cbiAgfSk7XG5cbiAgZ3JvdXBieUtleXMgPSBncm91cGJ5S2V5cy5tYXAoKGtleSkgPT4gYFwiJHtrZXl9XCJgKTtcblxuICByZXR1cm4gZ3JvdXBieUtleXMubGVuZ3RoID8gdXRpbC5mb3JtYXQoJ0dST1VQIEJZICVzJywgZ3JvdXBieUtleXMuam9pbignLCAnKSkgOiAnJztcbn07XG5cbnBhcnNlci5nZXRfbGltaXRfY2xhdXNlID0gZnVuY3Rpb24gZihxdWVyeU9iamVjdCkge1xuICBsZXQgbGltaXRDbGF1c2UgPSAnJztcbiAgT2JqZWN0LmtleXMocXVlcnlPYmplY3QpLmZvckVhY2goKGspID0+IHtcbiAgICBjb25zdCBxdWVyeUl0ZW0gPSBxdWVyeU9iamVjdFtrXTtcbiAgICBpZiAoay50b0xvd2VyQ2FzZSgpID09PSAnJGxpbWl0JyB8fCBrLnRvTG93ZXJDYXNlKCkgPT09ICckcGVyX3BhcnRpdGlvbl9saW1pdCcpIHtcbiAgICAgIGlmICh0eXBlb2YgcXVlcnlJdGVtICE9PSAnbnVtYmVyJykgdGhyb3cgKGJ1aWxkRXJyb3IoJ21vZGVsLmZpbmQubGltaXR0eXBlJykpO1xuICAgICAgbGltaXRDbGF1c2UgPSB1dGlsLmZvcm1hdCgnTElNSVQgJXMnLCBxdWVyeUl0ZW0pO1xuICAgIH1cbiAgICBpZiAoay50b0xvd2VyQ2FzZSgpID09PSAnJHBlcl9wYXJ0aXRpb25fbGltaXQnKSB7XG4gICAgICBsaW1pdENsYXVzZSA9IHV0aWwuZm9ybWF0KCdQRVIgUEFSVElUSU9OICVzJywgbGltaXRDbGF1c2UpO1xuICAgIH1cbiAgfSk7XG4gIHJldHVybiBsaW1pdENsYXVzZTtcbn07XG5cbnBhcnNlci5nZXRfc2VsZWN0X2NsYXVzZSA9IGZ1bmN0aW9uIGYob3B0aW9ucykge1xuICBsZXQgc2VsZWN0Q2xhdXNlID0gJyonO1xuICBpZiAob3B0aW9ucy5zZWxlY3QgJiYgXy5pc0FycmF5KG9wdGlvbnMuc2VsZWN0KSAmJiBvcHRpb25zLnNlbGVjdC5sZW5ndGggPiAwKSB7XG4gICAgY29uc3Qgc2VsZWN0QXJyYXkgPSBbXTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IG9wdGlvbnMuc2VsZWN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgICAvLyBzZXBhcmF0ZSB0aGUgYWdncmVnYXRlIGZ1bmN0aW9uIGFuZCB0aGUgY29sdW1uIG5hbWUgaWYgc2VsZWN0IGlzIGFuIGFnZ3JlZ2F0ZSBmdW5jdGlvblxuICAgICAgY29uc3Qgc2VsZWN0aW9uID0gb3B0aW9ucy5zZWxlY3RbaV0uc3BsaXQoL1soLCApXS9nKS5maWx0ZXIoKGUpID0+IChlKSk7XG4gICAgICBpZiAoc2VsZWN0aW9uLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICBpZiAoc2VsZWN0aW9uWzBdID09PSAnKicpIHNlbGVjdEFycmF5LnB1c2goJyonKTtcbiAgICAgICAgZWxzZSBzZWxlY3RBcnJheS5wdXNoKHV0aWwuZm9ybWF0KCdcIiVzXCInLCBzZWxlY3Rpb25bMF0pKTtcbiAgICAgIH0gZWxzZSBpZiAoc2VsZWN0aW9uLmxlbmd0aCA9PT0gMikge1xuICAgICAgICBzZWxlY3RBcnJheS5wdXNoKHV0aWwuZm9ybWF0KCclcyhcIiVzXCIpJywgc2VsZWN0aW9uWzBdLCBzZWxlY3Rpb25bMV0pKTtcbiAgICAgIH0gZWxzZSBpZiAoc2VsZWN0aW9uLmxlbmd0aCA+PSAzICYmIHNlbGVjdGlvbltzZWxlY3Rpb24ubGVuZ3RoIC0gMl0udG9Mb3dlckNhc2UoKSA9PT0gJ2FzJykge1xuICAgICAgICBjb25zdCBzZWxlY3Rpb25FbmRDaHVuayA9IHNlbGVjdGlvbi5zcGxpY2Uoc2VsZWN0aW9uLmxlbmd0aCAtIDIpO1xuICAgICAgICBsZXQgc2VsZWN0aW9uQ2h1bmsgPSAnJztcbiAgICAgICAgaWYgKHNlbGVjdGlvbi5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgICBzZWxlY3Rpb25DaHVuayA9IHV0aWwuZm9ybWF0KCdcIiVzXCInLCBzZWxlY3Rpb25bMF0pO1xuICAgICAgICB9IGVsc2UgaWYgKHNlbGVjdGlvbi5sZW5ndGggPT09IDIpIHtcbiAgICAgICAgICBzZWxlY3Rpb25DaHVuayA9IHV0aWwuZm9ybWF0KCclcyhcIiVzXCIpJywgc2VsZWN0aW9uWzBdLCBzZWxlY3Rpb25bMV0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHNlbGVjdGlvbkNodW5rID0gdXRpbC5mb3JtYXQoJyVzKCVzKScsIHNlbGVjdGlvblswXSwgYFwiJHtzZWxlY3Rpb24uc3BsaWNlKDEpLmpvaW4oJ1wiLFwiJyl9XCJgKTtcbiAgICAgICAgfVxuICAgICAgICBzZWxlY3RBcnJheS5wdXNoKHV0aWwuZm9ybWF0KCclcyBBUyBcIiVzXCInLCBzZWxlY3Rpb25DaHVuaywgc2VsZWN0aW9uRW5kQ2h1bmtbMV0pKTtcbiAgICAgIH0gZWxzZSBpZiAoc2VsZWN0aW9uLmxlbmd0aCA+PSAzKSB7XG4gICAgICAgIHNlbGVjdEFycmF5LnB1c2godXRpbC5mb3JtYXQoJyVzKCVzKScsIHNlbGVjdGlvblswXSwgYFwiJHtzZWxlY3Rpb24uc3BsaWNlKDEpLmpvaW4oJ1wiLFwiJyl9XCJgKSk7XG4gICAgICB9XG4gICAgfVxuICAgIHNlbGVjdENsYXVzZSA9IHNlbGVjdEFycmF5LmpvaW4oJywnKTtcbiAgfVxuICByZXR1cm4gc2VsZWN0Q2xhdXNlLnRyaW0oKTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gcGFyc2VyO1xuIl19