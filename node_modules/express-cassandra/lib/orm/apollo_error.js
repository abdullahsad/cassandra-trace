'use strict';

var util = require('util');

var AERROR_TYPES = {
  unspecified: {
    msg: 'Unspecified error ->'
  },
  'model.validator.invalidconfig': {
    msg: '%s'
  },
  'model.validator.invalidudt': {
    msg: '%s'
  },
  'model.validator.invalidudf': {
    msg: '%s'
  },
  'model.validator.invaliduda': {
    msg: '%s'
  },
  'model.validator.invalidschema': {
    msg: '%s'
  },
  'model.validator.invalidvalue': {
    msg: '%s'
  },
  'model.tablecreation.invalidname': {
    msg: 'Table names only allow alphanumeric and _ and must start with a letter, got %s'
  },
  'model.tablecreation.dbschemaquery': {
    msg: 'Error while retrieveing Schema of DB Table "%s"'
  },
  'model.tablecreation.schemamismatch': {
    msg: 'Given Schema does not match existing DB Table "%s"\n%s'
  },
  'model.tablecreation.schemanotfound': {
    msg: 'No DB Table was found for Given Schema -> %s'
  },
  'model.tablecreation.dbcreate': {
    msg: 'Error while creating DB Table -> %s'
  },
  'model.tablecreation.dbalter': {
    msg: 'Error while altering DB Table -> %s'
  },
  'model.tablecreation.dbdrop': {
    msg: 'Error while dropping DB Table -> %s'
  },
  'model.tablecreation.dbindexcreate': {
    msg: 'Error while creating index on DB Table -> %s'
  },
  'model.tablecreation.dbindexdrop': {
    msg: 'Error while dropping index on DB Table -> %s'
  },
  'model.tablecreation.matviewcreate': {
    msg: 'Error while creating materialized view on DB Table -> %s'
  },
  'model.tablecreation.matviewdrop': {
    msg: 'Error while dropping materialized view on DB Table -> %s'
  },
  'model.find.invalidop': {
    msg: 'Invalid field relation: unknown operator: "%s"'
  },
  'model.find.invalidexpr': {
    msg: '$expr must be an object containing the index name as string and query as string.'
  },
  'model.find.invalidsolrquery': {
    msg: '$solr_query must be a string containing the query for solr.'
  },
  'model.find.invalidorder': {
    msg: 'Invalid $orderby query, $orderby must be an object'
  },
  'model.find.invalidgroup': {
    msg: 'Invalid $groupby query, $groupby must be an array'
  },
  'model.find.multiorder': {
    msg: 'Invalid $orderby query: only one clause per object is allowed'
  },
  'model.find.invalidordertype': {
    msg: 'Invalid $orderby query, allowed order: $asc / $desc, given "%s"'
  },
  'model.find.limittype': {
    msg: '$limit must be an integer, given value "%s"'
  },
  'model.find.invalidinop': {
    msg: 'Invalid $in query. $in must be an array'
  },
  'model.find.invalidcontainsop': {
    msg: 'Invalid $contains query, $contains operator is only valid for indexed collections'
  },
  'model.find.invalidcontainskeyop': {
    msg: 'Invalid $contains_key query, $contains_key operator is only valid for indexed map collections'
  },
  'model.find.invalidtoken': {
    msg: 'Invalid $token query. $token must be an object with operator values'
  },
  'model.find.invalidtokenop': {
    msg: 'Invalid operator: "%s" in $token query'
  },
  'model.find.streamerror': {
    msg: 'Invalid stream query -> %s'
  },
  'model.find.eachrowerror': {
    msg: 'Invalid eachRow query -> %s'
  },
  'model.find.cberror': {
    msg: 'No valid callback function was provided'
  },
  'model.find.dberror': {
    msg: 'Error during find query on DB -> %s'
  },
  'model.save.unsetkey': {
    msg: 'Primary Key Field: %s must have a value'
  },
  'model.save.unsetrequired': {
    msg: 'Required Field: %s must have a value'
  },
  'model.save.invaliddefaultvalue': {
    msg: 'Invalid Default value: "%s" for Field: %s (Type: %s)'
  },
  'model.save.dberror': {
    msg: 'Error during save query on DB -> %s'
  },
  'model.save.before.error': {
    msg: 'Error in before_save lifecycle function'
  },
  'model.save.after.error': {
    msg: 'Error in after_save lifecycle function'
  },
  'model.update.unsetkey': {
    msg: 'Primary Key Field: %s must have a value'
  },
  'model.update.unsetrequired': {
    msg: 'Required Field: %s must have a value'
  },
  'model.update.invaliddefaultvalue': {
    msg: 'Invalid Default value: "%s" for Field: %s (Type: %s)'
  },
  'model.update.invalidreplaceop': {
    msg: 'Invalid $replace operation -> %s'
  },
  'model.update.invalidprependop': {
    msg: 'Invalid $prepend operation -> %s'
  },
  'model.update.dberror': {
    msg: 'Error during update query on DB -> %s'
  },
  'model.update.before.error': {
    msg: 'Error in before_update lifecycle function'
  },
  'model.update.after.error': {
    msg: 'Error in after_update lifecycle function'
  },
  'model.delete.dberror': {
    msg: 'Error during delete query on DB -> %s'
  },
  'model.delete.before.error': {
    msg: 'Error in before_delete lifecycle function'
  },
  'model.delete.after.error': {
    msg: 'Error in after_delete lifecycle function'
  }
};

var ERR_NAME_PREFIX = 'apollo';

var buildError = function f() {
  for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
    args[_key] = arguments[_key];
  }

  var argsarray = args;
  var name = argsarray.length ? argsarray.shift() : '_none_given_';

  var errorTemplate = AERROR_TYPES[name] || AERROR_TYPES.unspecified;
  var errorMsg = argsarray.length ? util.format.apply(this, [errorTemplate.msg].concat(argsarray)) : errorTemplate.msg;

  var error = new Error(errorMsg);
  error.name = (ERR_NAME_PREFIX ? util.format('%s.', ERR_NAME_PREFIX) : '') + name;

  return error;
};

module.exports = buildError;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9vcm0vYXBvbGxvX2Vycm9yLmpzIl0sIm5hbWVzIjpbInV0aWwiLCJyZXF1aXJlIiwiQUVSUk9SX1RZUEVTIiwidW5zcGVjaWZpZWQiLCJtc2ciLCJFUlJfTkFNRV9QUkVGSVgiLCJidWlsZEVycm9yIiwiZiIsImFyZ3MiLCJhcmdzYXJyYXkiLCJuYW1lIiwibGVuZ3RoIiwic2hpZnQiLCJlcnJvclRlbXBsYXRlIiwiZXJyb3JNc2ciLCJmb3JtYXQiLCJhcHBseSIsImNvbmNhdCIsImVycm9yIiwiRXJyb3IiLCJtb2R1bGUiLCJleHBvcnRzIl0sIm1hcHBpbmdzIjoiOztBQUFBLElBQU1BLE9BQU9DLFFBQVEsTUFBUixDQUFiOztBQUVBLElBQU1DLGVBQWU7QUFDbkJDLGVBQWE7QUFDWEMsU0FBSztBQURNLEdBRE07QUFJbkIsbUNBQWlDO0FBQy9CQSxTQUFLO0FBRDBCLEdBSmQ7QUFPbkIsZ0NBQThCO0FBQzVCQSxTQUFLO0FBRHVCLEdBUFg7QUFVbkIsZ0NBQThCO0FBQzVCQSxTQUFLO0FBRHVCLEdBVlg7QUFhbkIsZ0NBQThCO0FBQzVCQSxTQUFLO0FBRHVCLEdBYlg7QUFnQm5CLG1DQUFpQztBQUMvQkEsU0FBSztBQUQwQixHQWhCZDtBQW1CbkIsa0NBQWdDO0FBQzlCQSxTQUFLO0FBRHlCLEdBbkJiO0FBc0JuQixxQ0FBbUM7QUFDakNBLFNBQUs7QUFENEIsR0F0QmhCO0FBeUJuQix1Q0FBcUM7QUFDbkNBLFNBQUs7QUFEOEIsR0F6QmxCO0FBNEJuQix3Q0FBc0M7QUFDcENBLFNBQUs7QUFEK0IsR0E1Qm5CO0FBK0JuQix3Q0FBc0M7QUFDcENBLFNBQUs7QUFEK0IsR0EvQm5CO0FBa0NuQixrQ0FBZ0M7QUFDOUJBLFNBQUs7QUFEeUIsR0FsQ2I7QUFxQ25CLGlDQUErQjtBQUM3QkEsU0FBSztBQUR3QixHQXJDWjtBQXdDbkIsZ0NBQThCO0FBQzVCQSxTQUFLO0FBRHVCLEdBeENYO0FBMkNuQix1Q0FBcUM7QUFDbkNBLFNBQUs7QUFE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Qjs7QUFJQSxNQUFNYyxRQUFRLElBQUlDLEtBQUosQ0FBVUwsUUFBVixDQUFkO0FBQ0FJLFFBQU1SLElBQU4sR0FBYSxDQUFDTCxrQkFBa0JMLEtBQUtlLE1BQUwsQ0FBWSxLQUFaLEVBQW1CVixlQUFuQixDQUFsQixHQUF3RCxFQUF6RCxJQUErREssSUFBNUU7O0FBRUEsU0FBT1EsS0FBUDtBQUNELENBYkQ7O0FBZUFFLE9BQU9DLE9BQVAsR0FBaUJmLFVBQWpCIiwiZmlsZSI6ImFwb2xsb19lcnJvci5qcyIsInNvdXJjZXNDb250ZW50IjpbImNvbnN0IHV0aWwgPSByZXF1aXJlKCd1dGlsJyk7XG5cbmNvbnN0IEFFUlJPUl9UWVBFUyA9IHtcbiAgdW5zcGVjaWZpZWQ6IHtcbiAgICBtc2c6ICdVbnNwZWNpZmllZCBlcnJvciAtPicsXG4gIH0sXG4gICdtb2RlbC52YWxpZGF0b3IuaW52YWxpZGNvbmZpZyc6IHtcbiAgICBtc2c6ICclcycsXG4gIH0sXG4gICdtb2RlbC52YWxpZGF0b3IuaW52YWxpZHVkdCc6IHtcbiAgICBtc2c6ICclcycsXG4gIH0sXG4gICdtb2RlbC52YWxpZGF0b3IuaW52YWxpZHVkZic6IHtcbiAgICBtc2c6ICclcycsXG4gIH0sXG4gICdtb2RlbC52YWxpZGF0b3IuaW52YWxpZHVkYSc6IHtcbiAgICBtc2c6ICclcycsXG4gIH0sXG4gICdtb2RlbC52YWxpZGF0b3IuaW52YWxpZHNjaGVtYSc6IHtcbiAgICBtc2c6ICclcycsXG4gIH0sXG4gICdtb2RlbC52YWxpZGF0b3IuaW52YWxpZHZhbHVlJzoge1xuICAgIG1zZzogJyVzJyxcbiAgfSxcbiAgJ21vZGVsLnRhYmxlY3JlYXRpb24uaW52YWxpZG5hbWUnOiB7XG4gICAgbXNnOiAnVGFibGUgbmFtZXMgb25seSBhbGxvdyBhbHBoYW51bWVyaWMgYW5kIF8gYW5kIG11c3Qgc3RhcnQgd2l0aCBhIGxldHRlciwgZ290ICVzJyxcbiAgfSxcbiAgJ21vZGVsLnRhYmxlY3JlYXRpb24uZGJzY2hlbWFxdWVyeSc6IHtcbiAgICBtc2c6ICdFcnJvciB3aGlsZSByZXRyaWV2ZWluZyBTY2hlbWEgb2YgREIgVGFibGUgXCIlc1wiJyxcbiAgfSxcbiAgJ21vZGVsLnRhYmxlY3JlYXRpb24uc2NoZW1hbWlzbWF0Y2gnOiB7XG4gICAgbXNnOiAnR2l2ZW4gU2NoZW1hIGRvZXMgbm90IG1hdGNoIGV4aXN0aW5nIERCIFRhYmxlIFwiJXNcIlxcbiVzJyxcbiAgfSxcbiAgJ21vZGVsLnRhYmxlY3JlYXRpb24uc2NoZW1hbm90Zm91bmQnOiB7XG4gICAgbXNnOiAnTm8gREIgVGFibGUgd2FzIGZvdW5kIGZvciBHaXZlbiBTY2hlbWEgLT4gJXMnLFxuICB9LFxuICAnbW9kZWwudGFibGVjcmVhdGlvbi5kYmNyZWF0ZSc6IHtcbiAgICBtc2c6ICdFcnJvciB3aGlsZSBjcmVhdGluZyBEQiBUYWJsZSAtPiAlcycsXG4gIH0sXG4gICdtb2RlbC50YWJsZWNyZWF0aW9uLmRiYWx0ZXInOiB7XG4gICAgbXNnOiAnRXJyb3Igd2hpbGUgYWx0ZXJpbmcgREIgVGFibGUgLT4gJXMnLFxuICB9LFxuICAnbW9kZWwudGFibGVjcmVhdGlvbi5kYmRyb3AnOiB7XG4gICAgbXNnOiAnRXJyb3Igd2hpbGUgZHJvcHBpbmcgREIgVGFibGUgLT4gJXMnLFxuICB9LFxuICAnbW9kZWwudGFibGVjcmVhdGlvbi5kYmluZGV4Y3JlYXRlJzoge1xuICAgIG1zZzogJ0Vycm9yIHdoaWxlIGNyZWF0aW5nIGluZGV4IG9uIERCIFRhYmxlIC0+ICVzJyxcbiAgfSxcbiAgJ21vZGVsLnRhYmxlY3JlYXRpb24uZGJpbmRleGRyb3AnOiB7XG4gICAgbXNnOiAnRXJyb3Igd2hpbGUgZHJvcHBpbmcgaW5kZXggb24gREIgVGFibGUgLT4gJXMnLFxuICB9LFxuICAnbW9kZWwudGFibGVjcmVhdGlvbi5tYXR2aWV3Y3JlYXRlJzoge1xuICAgIG1zZzogJ0Vycm9yIHdoaWxlIGNyZWF0aW5nIG1hdGVyaWFsaXplZCB2aWV3IG9uIERCIFRhYmxlIC0+ICVzJyxcbiAgfSxcbiAgJ21vZGVsLnRhYmxlY3JlYXRpb24ubWF0dmlld2Ryb3AnOiB7XG4gICAgbXNnOiAnRXJyb3Igd2hpbGUgZHJvcHBpbmcgbWF0ZXJpYWxpemVkIHZpZXcgb24gREIgVGFibGUgLT4gJXMnLFxuICB9LFxuICAnbW9kZWwuZmluZC5pbnZhbGlkb3AnOiB7XG4gICAgbXNnOiAnSW52YWxpZCBmaWVsZCByZWxhdGlvbjogdW5rbm93biBvcGVyYXRvcjogXCIlc1wiJyxcbiAgfSxcbiAgJ21vZGVsLmZpbmQuaW52YWxpZGV4cHInOiB7XG4gICAgbXNnOiAnJGV4cHIgbXVzdCBiZSBhbiBvYmplY3QgY29udGFpbmluZyB0aGUgaW5kZXggbmFtZSBhcyBzdHJpbmcgYW5kIHF1ZXJ5IGFzIHN0cmluZy4nLFxuICB9LFxuICAnbW9kZWwuZmluZC5pbnZhbGlkc29scnF1ZXJ5Jzoge1xuICAgIG1zZzogJyRzb2xyX3F1ZXJ5IG11c3QgYmUgYSBzdHJpbmcgY29udGFpbmluZyB0aGUgcXVlcnkgZm9yIHNvbHIuJyxcbiAgfSxcbiAgJ21vZGVsLmZpbmQuaW52YWxpZG9yZGVyJzoge1xuICAgIG1zZzogJ0ludmFsaWQgJG9yZGVyYnkgcXVlcnksICRvcmRlcmJ5IG11c3QgYmUgYW4gb2JqZWN0JyxcbiAgfSxcbiAgJ21vZGVsLmZpbmQuaW52YWxpZGdyb3VwJzoge1xuICAgIG1zZzogJ0ludmFsaWQgJGdyb3VwYnkgcXVlcnksICRncm91cGJ5IG11c3QgYmUgYW4gYXJyYXknLFxuICB9LFxuICAnbW9kZWwuZmluZC5tdWx0aW9yZGVyJzoge1xuICAgIG1zZzogJ0ludmFsaWQgJG9yZGVyYnkgcXVlcnk6IG9ubHkgb25lIGNsYXVzZSBwZXIgb2JqZWN0IGlzIGFsbG93ZWQnLFxuICB9LFxuICAnbW9kZWwuZmluZC5pbnZhbGlkb3JkZXJ0eXBlJzoge1xuICAgIG1zZzogJ0ludmFsaWQgJG9yZGVyYnkgcXVlcnksIGFsbG93ZWQgb3JkZXI6ICRhc2MgLyAkZGVzYywgZ2l2ZW4gXCIlc1wiJyxcbiAgfSxcbiAgJ21vZGVsLmZpbmQubGltaXR0eXBlJzoge1xuICAgIG1zZzogJyRsaW1pdCBtdXN0IGJlIGFuIGludGVnZXIsIGdpdmVuIHZhbHVlIFwiJXNcIicsXG4gIH0sXG4gICdtb2RlbC5maW5kLmludmFsaWRpbm9wJzoge1xuICAgIG1zZzogJ0ludmFsaWQgJGluIHF1ZXJ5LiAkaW4gbXVzdCBiZSBhbiBhcnJheScsXG4gIH0sXG4gICdtb2RlbC5maW5kLmludmFsaWRjb250YWluc29wJzoge1xuICAgIG1zZzogJ0ludmFsaWQgJGNvbnRhaW5zIHF1ZXJ5LCAkY29udGFpbnMgb3BlcmF0b3IgaXMgb25seSB2YWxpZCBmb3IgaW5kZXhlZCBjb2xsZWN0aW9ucycsXG4gIH0sXG4gICdtb2RlbC5maW5kLmludmFsaWRjb250YWluc2tleW9wJzoge1xuICAgIG1zZzogJ0ludmFsaWQgJGNvbnRhaW5zX2tleSBxdWVyeSwgJGNvbnRhaW5zX2tleSBvcGVyYXRvciBpcyBvbmx5IHZhbGlkIGZvciBpbmRleGVkIG1hcCBjb2xsZWN0aW9ucycsXG4gIH0sXG4gICdtb2RlbC5maW5kLmludmFsaWR0b2tlbic6IHtcbiAgICBtc2c6ICdJbnZhbGlkICR0b2tlbiBxdWVyeS4gJHRva2VuIG11c3QgYmUgYW4gb2JqZWN0IHdpdGggb3BlcmF0b3IgdmFsdWVzJyxcbiAgfSxcbiAgJ21vZGVsLmZpbmQuaW52YWxpZHRva2Vub3AnOiB7XG4gICAgbXNnOiAnSW52YWxpZCBvcGVyYXRvcjogXCIlc1wiIGluICR0b2tlbiBxdWVyeScsXG4gIH0sXG4gICdtb2RlbC5maW5kLnN0cmVhbWVycm9yJzoge1xuICAgIG1zZzogJ0ludmFsaWQgc3RyZWFtIHF1ZXJ5IC0+ICVzJyxcbiAgfSxcbiAgJ21vZGVsLmZpbmQuZWFjaHJvd2Vycm9yJzoge1xuICAgIG1zZzogJ0ludmFsaWQgZWFjaFJvdyBxdWVyeSAtPiAlcycsXG4gIH0sXG4gICdtb2RlbC5maW5kLmNiZXJyb3InOiB7XG4gICAgbXNnOiAnTm8gdmFsaWQgY2FsbGJhY2sgZnVuY3Rpb24gd2FzIHByb3ZpZGVkJyxcbiAgfSxcbiAgJ21vZGVsLmZpbmQuZGJlcnJvcic6IHtcbiAgICBtc2c6ICdFcnJvciBkdXJpbmcgZmluZCBxdWVyeSBvbiBEQiAtPiAlcycsXG4gIH0sXG4gICdtb2RlbC5zYXZlLnVuc2V0a2V5Jzoge1xuICAgIG1zZzogJ1ByaW1hcnkgS2V5IEZpZWxkOiAlcyBtdXN0IGhhdmUgYSB2YWx1ZScsXG4gIH0sXG4gICdtb2RlbC5zYXZlLnVuc2V0cmVxdWlyZWQnOiB7XG4gICAgbXNnOiAnUmVxdWlyZWQgRmllbGQ6ICVzIG11c3QgaGF2ZSBhIHZhbHVlJyxcbiAgfSxcbiAgJ21vZGVsLnNhdmUuaW52YWxpZGRlZmF1bHR2YWx1ZSc6IHtcbiAgICBtc2c6ICdJbnZhbGlkIERlZmF1bHQgdmFsdWU6IFwiJXNcIiBmb3IgRmllbGQ6ICVzIChUeXBlOiAlcyknLFxuICB9LFxuICAnbW9kZWwuc2F2ZS5kYmVycm9yJzoge1xuICAgIG1zZzogJ0Vycm9yIGR1cmluZyBzYXZlIHF1ZXJ5IG9uIERCIC0+ICVzJyxcbiAgfSxcbiAgJ21vZGVsLnNhdmUuYmVmb3JlLmVycm9yJzoge1xuICAgIG1zZzogJ0Vycm9yIGluIGJlZm9yZV9zYXZlIGxpZmVjeWNsZSBmdW5jdGlvbicsXG4gIH0sXG4gICdtb2RlbC5zYXZlLmFmdGVyLmVycm9yJzoge1xuICAgIG1zZzogJ0Vycm9yIGluIGFmdGVyX3NhdmUgbGlmZWN5Y2xlIGZ1bmN0aW9uJyxcbiAgfSxcbiAgJ21vZGVsLnVwZGF0ZS51bnNldGtleSc6IHtcbiAgICBtc2c6ICdQcmltYXJ5IEtleSBGaWVsZDogJXMgbXVzdCBoYXZlIGEgdmFsdWUnLFxuICB9LFxuICAnbW9kZWwudXBkYXRlLnVuc2V0cmVxdWlyZWQnOiB7XG4gICAgbXNnOiAnUmVxdWlyZWQgRmllbGQ6ICVzIG11c3QgaGF2ZSBhIHZhbHVlJyxcbiAgfSxcbiAgJ21vZGVsLnVwZGF0ZS5pbnZhbGlkZGVmYXVsdHZhbHVlJzoge1xuICAgIG1zZzogJ0ludmFsaWQgRGVmYXVsdCB2YWx1ZTogXCIlc1wiIGZvciBGaWVsZDogJXMgKFR5cGU6ICVzKScsXG4gIH0sXG4gICdtb2RlbC51cGRhdGUuaW52YWxpZHJlcGxhY2VvcCc6IHtcbiAgICBtc2c6ICdJbnZhbGlkICRyZXBsYWNlIG9wZXJhdGlvbiAtPiAlcycsXG4gIH0sXG4gICdtb2RlbC51cGRhdGUuaW52YWxpZHByZXBlbmRvcCc6IHtcbiAgICBtc2c6ICdJbnZhbGlkICRwcmVwZW5kIG9wZXJhdGlvbiAtPiAlcycsXG4gIH0sXG4gICdtb2RlbC51cGRhdGUuZGJlcnJvcic6IHtcbiAgICBtc2c6ICdFcnJvciBkdXJpbmcgdXBkYXRlIHF1ZXJ5IG9uIERCIC0+ICVzJyxcbiAgfSxcbiAgJ21vZGVsLnVwZGF0ZS5iZWZvcmUuZXJyb3InOiB7XG4gICAgbXNnOiAnRXJyb3IgaW4gYmVmb3JlX3VwZGF0ZSBsaWZlY3ljbGUgZnVuY3Rpb24nLFxuICB9LFxuICAnbW9kZWwudXBkYXRlLmFmdGVyLmVycm9yJzoge1xuICAgIG1zZzogJ0Vycm9yIGluIGFmdGVyX3VwZGF0ZSBsaWZlY3ljbGUgZnVuY3Rpb24nLFxuICB9LFxuICAnbW9kZWwuZGVsZXRlLmRiZXJyb3InOiB7XG4gICAgbXNnOiAnRXJyb3IgZHVyaW5nIGRlbGV0ZSBxdWVyeSBvbiBEQiAtPiAlcycsXG4gIH0sXG4gICdtb2RlbC5kZWxldGUuYmVmb3JlLmVycm9yJzoge1xuICAgIG1zZzogJ0Vycm9yIGluIGJlZm9yZV9kZWxldGUgbGlmZWN5Y2xlIGZ1bmN0aW9uJyxcbiAgfSxcbiAgJ21vZGVsLmRlbGV0ZS5hZnRlci5lcnJvcic6IHtcbiAgICBtc2c6ICdFcnJvciBpbiBhZnRlcl9kZWxldGUgbGlmZWN5Y2xlIGZ1bmN0aW9uJyxcbiAgfSxcbn07XG5cbmNvbnN0IEVSUl9OQU1FX1BSRUZJWCA9ICdhcG9sbG8nO1xuXG5jb25zdCBidWlsZEVycm9yID0gZnVuY3Rpb24gZiguLi5hcmdzKSB7XG4gIGNvbnN0IGFyZ3NhcnJheSA9IGFyZ3M7XG4gIGNvbnN0IG5hbWUgPSBhcmdzYXJyYXkubGVuZ3RoID8gYXJnc2FycmF5LnNoaWZ0KCkgOiAnX25vbmVfZ2l2ZW5fJztcblxuICBjb25zdCBlcnJvclRlbXBsYXRlID0gQUVSUk9SX1RZUEVTW25hbWVdIHx8IEFFUlJPUl9UWVBFUy51bnNwZWNpZmllZDtcbiAgY29uc3QgZXJyb3JNc2cgPSBhcmdzYXJyYXkubGVuZ3RoID9cbiAgICB1dGlsLmZvcm1hdC5hcHBseSh0aGlzLCBbZXJyb3JUZW1wbGF0ZS5tc2ddLmNvbmNhdChhcmdzYXJyYXkpKSA6XG4gICAgZXJyb3JUZW1wbGF0ZS5tc2c7XG5cbiAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3IoZXJyb3JNc2cpO1xuICBlcnJvci5uYW1lID0gKEVSUl9OQU1FX1BSRUZJWCA/IHV0aWwuZm9ybWF0KCclcy4nLCBFUlJfTkFNRV9QUkVGSVgpIDogJycpICsgbmFtZTtcblxuICByZXR1cm4gZXJyb3I7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGJ1aWxkRXJyb3I7XG4iXX0=