'use strict';

var _ = require('lodash');
var debug = require('debug')('express-cassandra');

var JanusGraphBuilder = function f(client, config) {
  this._client = client;
  this._config = config;
};

JanusGraphBuilder.prototype = {
  create_graph(graphName, callback) {
    debug('creating janus graph: %s', graphName);
    var script = `
      Map<String, Object> map = new HashMap<String, Object>();
      map.put("storage.backend", storageBackend);
      map.put("storage.hostname", storageHostname);
      map.put("storage.port", storagePort);
      map.put("index.search.backend", indexBackend);
      map.put("index.search.hostname", indexHostname);
      map.put("index.search.port", indexPort);
      map.put("graph.graphname", graphName);
      ConfiguredGraphFactory.createConfiguration(new MapConfiguration(map));
      ConfiguredGraphFactory.open(graphName).vertices().size();
    `;
    var bindings = {
      storageBackend: this._config.storage.backend,
      storageHostname: this._config.storage.hostname,
      storagePort: this._config.storage.port,
      indexBackend: this._config.index.search.backend,
      indexHostname: this._config.index.search.hostname,
      indexPort: this._config.index.search.port,
      graphName
    };
    this._client.execute(script, bindings, function (err, results) {
      if (err) {
        callback(err);
        return;
      }

      callback(null, results);
    });
  },

  check_graph_exist(graphName, callback) {
    debug('check for janus graph: %s', graphName);
    var script = `
      ConfiguredGraphFactory.getGraphNames();
    `;
    var bindings = {};
    this._client.execute(script, bindings, function (err, results) {
      if (err) {
        callback(err);
        return;
      }

      if (_.isArray(results) && results.includes(graphName)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    });
  },

  assert_graph(graphName, callback) {
    var _this = this;

    this.check_graph_exist(graphName, function (err, exist) {
      if (err) {
        callback(err);
        return;
      }

      if (!exist) {
        _this.create_graph(graphName, callback);
        return;
      }

      callback();
    });
  },

  drop_graph(graphName, callback) {
    debug('removing janus graph: %s', graphName);
    var script = `
      ConfiguredGraphFactory.drop(graphName);
    `;
    var bindings = {
      graphName
    };
    this._client.execute(script, bindings, function (err, results) {
      if (err) {
        callback(err);
        return;
      }

      callback(null, results);
    });
  },

  put_indexes(graphName, mappingName, indexes, callback) {
    debug('syncing janus graph indexes for: %s', mappingName);
    var script = `
      graph = ConfiguredGraphFactory.open(graphName);
      graph.tx().commit();
      mgmt = graph.openManagement();
    `;
    var bindings = {
      graphName
    };
    // create indexes if not exist
    Object.keys(indexes).forEach(function (index) {
      if (indexes[index].type === 'Composite') {
        script += `if (!mgmt.containsGraphIndex('${index}')) mgmt.buildIndex('${index}', Vertex.class)`;
        indexes[index].keys.forEach(function (key) {
          script += `.addKey(mgmt.getPropertyKey('${key}'))`;
        });
        script += `.indexOnly(mgmt.getVertexLabel('${mappingName}'))`;
        if (indexes[index].unique) {
          script += '.unique()';
        }
        script += '.buildCompositeIndex();';
      } else if (indexes[index].type === 'Mixed') {
        script += `if (!mgmt.containsGraphIndex('${index}')) mgmt.buildIndex('${index}', Vertex.class)`;
        indexes[index].keys.forEach(function (key) {
          script += `.addKey(mgmt.getPropertyKey('${key}'))`;
        });
        script += `.indexOnly(mgmt.getVertexLabel('${mappingName}'))`;
        if (indexes[index].unique) {
          script += '.unique()';
        }
        script += '.buildMixedIndex("search");';
      } else if (indexes[index].type === 'VertexCentric') {
        script += `relationLabel = mgmt.getEdgeLabel('${indexes[index].label}');`;
        script += `if (!mgmt.containsRelationIndex(relationLabel, '${index}')) mgmt.buildEdgeIndex(relationLabel, '${index}', Direction.${indexes[index].direction}, Order.${indexes[index].order}`;
        indexes[index].keys.forEach(function (key) {
          script += `, mgmt.getPropertyKey('${key}')`;
        });
        script += ');';
      }
    });
    script += 'mgmt.commit();';
    // await index for registered or enabled status
    Object.keys(indexes).forEach(function (index) {
      if (indexes[index].type === 'Composite') {
        script += `mgmt.awaitGraphIndexStatus(graph, '${index}').status(SchemaStatus.REGISTERED, SchemaStatus.ENABLED).call();`;
      } else if (indexes[index].type === 'Mixed') {
        script += `mgmt.awaitGraphIndexStatus(graph, '${index}').status(SchemaStatus.REGISTERED, SchemaStatus.ENABLED).call();`;
      } else if (indexes[index].type === 'VertexCentric') {
        script += `mgmt.awaitRelationIndexStatus(graph, '${index}', '${indexes[index].label}').status(SchemaStatus.REGISTERED, SchemaStatus.ENABLED).call();`;
      }
    });
    // enable index if in registered state
    script += 'mgmt = graph.openManagement();';
    Object.keys(indexes).forEach(function (index) {
      if (indexes[index].type === 'Composite') {
        script += `if (mgmt.getGraphIndex('${index}').getIndexStatus(mgmt.getPropertyKey('${indexes[index].keys[0]}')).equals(SchemaStatus.REGISTERED)) mgmt.updateIndex(mgmt.getGraphIndex('${index}'), SchemaAction.ENABLE_INDEX);`;
      } else if (indexes[index].type === 'Mixed') {
        script += `if (mgmt.getGraphIndex('${index}').getIndexStatus(mgmt.getPropertyKey('${indexes[index].keys[0]}')).equals(SchemaStatus.REGISTERED)) mgmt.updateIndex(mgmt.getGraphIndex('${index}'), SchemaAction.ENABLE_INDEX);`;
      } else if (indexes[index].type === 'VertexCentric') {
        script += `if (mgmt.getRelationIndex(mgmt.getEdgeLabel('${indexes[index].label}'), '${index}').getIndexStatus().equals(SchemaStatus.REGISTERED)) mgmt.updateIndex(mgmt.getRelationIndex(mgmt.getEdgeLabel('${indexes[index].label}'), '${index}'), SchemaAction.ENABLE_INDEX);`;
      }
    });
    script += 'mgmt.commit();';
    // await index for enabled status
    Object.keys(indexes).forEach(function (index) {
      if (indexes[index].type === 'Composite') {
        script += `mgmt.awaitGraphIndexStatus(graph, '${index}').status(SchemaStatus.ENABLED).call();`;
      } else if (indexes[index].type === 'Mixed') {
        script += `mgmt.awaitGraphIndexStatus(graph, '${index}').status(SchemaStatus.ENABLED).call();`;
      } else if (indexes[index].type === 'VertexCentric') {
        script += `mgmt.awaitRelationIndexStatus(graph, '${index}', '${indexes[index].label}').status(SchemaStatus.ENABLED).call();`;
      }
    });
    this._client.execute(script, bindings, function (err, results) {
      if (err) {
        callback(err);
        return;
      }

      callback(null, results);
    });
  },

  put_mapping(graphName, mappingName, mappingBody, callback) {
    var _this2 = this;

    debug('syncing janus graph mapping: %s', mappingName);
    var script = `
      graph = ConfiguredGraphFactory.open(graphName);
      graph.tx().commit();
      mgmt = graph.openManagement();
      if (!mgmt.containsVertexLabel(mappingName)) mgmt.makeVertexLabel(mappingName).make();
    `;
    var bindings = {
      graphName,
      mappingName
    };
    Object.keys(mappingBody.relations).forEach(function (relation) {
      script += `
        if (!mgmt.containsEdgeLabel('${relation}')) mgmt.makeEdgeLabel('${relation}').multiplicity(${mappingBody.relations[relation]}).make();
      `;
    });
    Object.keys(mappingBody.properties).forEach(function (property) {
      script += `
        if (!mgmt.containsPropertyKey('${property}')) mgmt.makePropertyKey('${property}').dataType(${mappingBody.properties[property].type}.class).cardinality(Cardinality.${mappingBody.properties[property].cardinality}).make();
      `;
    });
    script += 'mgmt.commit();';
    this._client.execute(script, bindings, function (err, results) {
      if (err) {
        callback(err);
        return;
      }

      if (Object.keys(mappingBody.indexes).length > 0) {
        _this2.put_indexes(graphName, mappingName, mappingBody.indexes, callback);
        return;
      }

      callback(null, results);
    });
  }
};

module.exports = JanusGraphBuilder;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9idWlsZGVycy9qYW51c2dyYXBoLmpzIl0sIm5hbWVzIjpbIl8iLCJyZXF1aXJlIiwiZGVidWciLCJKYW51c0dyYXBoQnVpbGRlciIsImYiLCJjbGllbnQiLCJjb25maWciLCJfY2xpZW50IiwiX2NvbmZpZyIsInByb3RvdHlwZSIsImNyZWF0ZV9ncmFwaCIsImdyYXBoTmFtZSIsImNhbGxiYWNrIiwic2NyaXB0IiwiYmluZGluZ3MiLCJzdG9yYWdlQmFja2VuZCIsInN0b3JhZ2UiLCJiYWNrZW5kIiwic3RvcmFnZUhvc3RuYW1lIiwiaG9zdG5hbWUiLCJzdG9yYWdlUG9ydCIsInBvcnQiLCJpbmRleEJhY2tlbmQiLCJpbmRleCIsInNlYXJjaCIsImluZGV4SG9zdG5hbWUiLCJpbmRleFBvcnQiLCJleGVjdXRlIiwiZXJyIiwicmVzdWx0cyIsImNoZWNrX2dyYXBoX2V4aXN0IiwiaXNBcnJheSIsImluY2x1ZGVzIiwiYXNzZXJ0X2dyYXBoIiwiZXhpc3QiLCJkcm9wX2dyYXBoIiwicHV0X2luZGV4ZXMiLCJtYXBwaW5nTmFtZSIsImluZGV4ZXMiLCJPYmplY3QiLCJrZXlzIiwiZm9yRWFjaCIsInR5cGUiLCJrZXkiLCJ1bmlxdWUiLCJsYWJlbCIsImRpcmVjdGlvbiIsIm9yZGVyIiwicHV0X21hcHBpbmciLCJtYXBwaW5nQm9keSIsInJlbGF0aW9ucyIsInJlbGF0aW9uIiwicHJvcGVydGllcyIsInByb3BlcnR5IiwiY2FyZGluYWxpdHkiLCJsZW5ndGgiLCJtb2R1bGUiLCJleHBvcnRzIl0sIm1hcHBpbmdzIjoiOztBQUFBLElBQU1BLElBQUlDLFFBQVEsUUFBUixDQUFWO0FBQ0EsSUFBTUMsUUFBUUQsUUFBUSxPQUFSLEVBQWlCLG1CQUFqQixDQUFkOztBQUVBLElBQU1FLG9CQUFvQixTQUFTQyxDQUFULENBQVdDLE1BQVgsRUFBbUJDLE1BQW5CLEVBQTJCO0FBQ25ELE9BQUtDLE9BQUwsR0FBZUYsTUFBZjtBQUNBLE9BQUtHLE9BQUwsR0FBZUYsTUFBZjtBQUNELENBSEQ7O0FBS0FILGtCQUFrQk0sU0FBbEIsR0FBOEI7QUFDNUJDLGVBQWFDLFNBQWIsRUFBd0JDLFFBQXhCLEVBQWtDO0FBQ2hDVixVQUFNLDBCQUFOLEVBQWtDUyxTQUFsQztBQUNBLFFBQU1FLFNBQVU7Ozs7Ozs7Ozs7O0tBQWhCO0FBWUEsUUFBTUMsV0FBVztBQUNmQyxzQkFBZ0IsS0FBS1AsT0FBTCxDQUFhUSxPQUFiLENBQXFCQyxPQUR0QjtBQUVmQyx1QkFBaUIsS0FBS1YsT0FBTCxDQUFhUSxPQUFiLENBQXFCRyxRQUZ2QjtBQUdmQyxtQkFBYSxLQUFLWixPQUFMLENBQWFRLE9BQWIsQ0FBcUJLLElBSG5CO0FBSWZDLG9CQUFjLEtBQUtkLE9BQUwsQ0FBYWUsS0FBYixDQUFtQkMsTUFBbkIsQ0FBMEJQLE9BSnpCO0FBS2ZRLHFCQUFlLEtBQUtqQixPQUFMLENBQWFlLEtBQWIsQ0FBbUJDLE1BQW5CLENBQTBCTCxRQUwxQjtBQU1mTyxpQkFBVyxLQUFLbEIsT0FBTCxDQUFhZSxLQUFiLENBQW1CQyxNQUFuQixDQUEwQkgsSUFOdEI7QUFPZlY7QUFQZSxLQUFqQjtBQVNBLFNBQUtKLE9BQUwsQ0FBYW9CLE9BQWIsQ0FBcUJkLE1BQXJCLEVBQTZCQyxRQUE3QixFQUF1QyxVQUFDYyxHQUFELEVBQU1DLE9BQU4sRUFBa0I7QUFDdkQsVUFBSUQsR0FBSixFQUFTO0FBQ1BoQixpQkFBU2dCLEdBQVQ7QUFDQTtBQUNEOztBQUVEaEIsZUFBUyxJQUFULEVBQWVpQixPQUFmO0FBQ0QsS0FQRDtBQVFELEdBaEMyQjs7QUFrQzVCQyxvQkFBa0JuQixTQUFsQixFQUE2QkMsUUFBN0IsRUFBdUM7QUFDckNWLFVBQU0sMkJBQU4sRUFBbUNTLFNBQW5DO0FBQ0EsUUFBTUUsU0FBVTs7S0FBaEI7QUFHQSxRQUFNQyxXQUFXLEVBQWpCO0FBQ0EsU0FBS1AsT0FBTCxDQUFhb0IsT0FBYixDQUFxQmQsTUFBckIsRUFBNkJDLFFBQTdCLEVBQXVDLFVBQUNjLEdBQUQsRUFBTUMsT0FBTixFQUFrQjtBQUN2RCxVQUFJRCxHQUFKLEVBQVM7QUFDUGhCLGlCQUFTZ0IsR0FBVDtBQUNBO0FBQ0Q7O0FBRUQsVUFBSTVCLEVBQUUrQixPQUFGLENBQVVGLE9BQVYsS0FBc0JBLFFBQVFHLFFBQVIsQ0FBaUJyQixTQUFqQixDQUExQixFQUF1RDtBQUNyREMsaUJBQVMsSUFBVCxFQUFlLElBQWY7QUFDQTtBQUNEO0FBQ0RBLGVBQVMsSUFBVCxFQUFlLEtBQWY7QUFDRCxLQVhEO0FBWUQsR0FwRDJCOztBQXNENUJxQixlQUFhdEIsU0FBYixFQUF3QkMsUUFBeEIsRUFBa0M7QUFBQTs7QUFDaEMsU0FBS2tCLGlCQUFMLENBQXVCbkIsU0FBdkIsRUFBa0MsVUFBQ2lCLEdBQUQsRUFBTU0sS0FBTixFQUFnQjtBQUNoRCxVQUFJTixHQUFKLEVBQVM7QUFDUGhCLGlCQUFTZ0IsR0FBVDtBQUNBO0FBQ0Q7O0FBRUQsVUFBSSxDQUFDTSxLQUFMLEVBQVk7QUFDVixjQUFLeEIsWUFBTCxDQUFrQkMsU0FBbEIsRUFBNkJDLFFBQTdCO0FBQ0E7QUFDRDs7QUFFREE7QUFDRCxLQVpEO0FBYUQsR0FwRTJCOztBQXNFNUJ1QixhQUFXeEIsU0FBWCxFQUFzQkMsUUFBdEIsRUFBZ0M7QUFDOUJWLFVBQU0sMEJBQU4sRUFBa0NTLFNBQWxDO0FBQ0EsUUFBTUUsU0FBVTs7S0FBaEI7QUFHQSxRQUFNQyxXQUFXO0FBQ2ZIO0FBRGUsS0FBakI7QUFHQSxTQUFLSixPQUFMLENBQWFvQixPQUFiLENBQXFCZCxNQUFyQixFQUE2QkMsUUFBN0IsRUFBdUMsVUFBQ2MsR0FBRCxFQUFNQyxPQUFOLEVBQWtCO0FBQ3ZELFVBQUlELEdBQUosRUFBUztBQUNQaEIsaUJBQVNnQixHQUFUO0FBQ0E7QUFDRDs7QUFFRGhCLGVBQVMsSUFBVCxFQUFlaUIsT0FBZjtBQUNELEtBUEQ7QUFRRCxHQXRGMkI7O0FBd0Y1Qk8sY0FBWXpCLFNBQVosRUFBdUIwQixXQUF2QixFQUFvQ0MsT0FBcEMsRUFBNkMxQixRQUE3QyxFQUF1RDtBQUNyRFYsVUFBTSxxQ0FBTixFQUE2Q21DLFdBQTdDO0FBQ0EsUUFBSXhCLFNBQVU7Ozs7S0FBZDtBQUtBLFFBQU1DLFdBQVc7QUFDZkg7QUFEZSxLQUFqQjtBQUdBO0FBQ0E0QixXQUFPQyxJQUFQLENBQVlGLE9BQVosRUFBcUJHLE9BQXJCLENBQTZCLFVBQUNsQixLQUFELEVBQVc7QUFDdEMsVUFBSWUsUUFBUWYsS0FBUixFQUFlbUIsSUFBZixLQUF3QixXQUE1QixFQUF5QztBQUN2QzdCLGtCQUFXLGlDQUFnQ1UsS0FBTSx3QkFBdUJBLEtBQU0sa0JBQTlFO0FBQ0FlLGdCQUFRZixLQUFSLEVBQWVpQixJQUFmLENBQW9CQyxPQUFwQixDQUE0QixVQUFDRSxHQUFELEVBQVM7QUFDbkM5QixvQkFBVyxnQ0FBK0I4QixHQUFJLEtBQTlDO0FBQ0QsU0FGRDtBQUdBOUIsa0JBQVcsbUNBQWtDd0IsV0FBWSxLQUF6RDtBQUNBLFlBQUlDLFFBQVFmLEtBQVIsRUFBZXFCLE1BQW5CLEVBQTJCO0FBQ3pCL0Isb0JBQVUsV0FBVjtBQUNEO0FBQ0RBLGtCQUFVLHlCQUFWO0FBQ0QsT0FWRCxNQVVPLElBQUl5QixRQUFRZixLQUFSLEVBQWVtQixJQUFmLEtBQXdCLE9BQTVCLEVBQXFDO0FBQzFDN0Isa0JBQVcsaUNBQWdDVSxLQUFNLHdCQUF1QkEsS0FBTSxrQkFBOUU7QUFDQWUsZ0JBQVFmLEtBQVIsRUFBZWlCLElBQWYsQ0FBb0JDLE9BQXBCLENBQTRCLFVBQUNFLEdBQUQsRUFBUztBQUNuQzlCLG9CQUFXLGdDQUErQjhCLEdBQUksS0FBOUM7QUFDRCxTQUZEO0FBR0E5QixrQkFBVyxtQ0FBa0N3QixXQUFZLEtBQXpEO0FBQ0EsWUFBSUMsUUFBUWYsS0FBUixFQUFlcUIsTUFBbkIsRUFBMkI7QUFDekIvQixvQkFBVSxXQUFWO0FBQ0Q7QUFDREEsa0JBQVUsNkJBQVY7QUFDRCxPQVZNLE1BVUEsSUFBSXlCLFFBQVFmLEtBQVIsRUFBZW1CLElBQWYsS0FBd0IsZUFBNUIsRUFBNkM7QUFDbEQ3QixrQkFBVyxzQ0FBcUN5QixRQUFRZixLQUFSLEVBQWVzQixLQUFNLEtBQXJFO0FBQ0FoQyxrQkFBVyxtREFBa0RVLEtBQU0sMkNBQTBDQSxLQUFNLGdCQUFlZSxRQUFRZixLQUFSLEVBQWV1QixTQUFVLFdBQVVSLFFBQVFmLEtBQVIsRUFBZXdCLEtBQU0sRUFBMUw7QUFDQVQsZ0JBQVFmLEtBQVIsRUFBZWlCLElBQWYsQ0FBb0JDLE9BQXBCLENBQTRCLFVBQUNFLEdBQUQsRUFBUztBQUNuQzlCLG9CQUFXLDBCQUF5QjhCLEdBQUksSUFBeEM7QUFDRCxTQUZEO0FBR0E5QixrQkFBVSxJQUFWO0FBQ0Q7QUFDRixLQTdCRDtBQThCQUEsY0FBVSxnQkFBVjtBQUNBO0FBQ0EwQixXQUFPQyxJQUFQLENBQVlGLE9BQVosRUFBcUJHLE9BQXJCLENBQTZCLFVBQUNsQixLQUFELEVBQVc7QUFDdEMsVUFBSWUsUUFBUWYsS0FBUixFQUFlbUIsSUFBZixLQUF3QixXQUE1QixFQUF5QztBQUN2QzdCLGtCQUFXLHNDQUFxQ1UsS0FBTSxrRUFBdEQ7QUFDRCxPQUZELE1BRU8sSUFBSWUsUUFBUWYsS0FBUixFQUFlbUIsSUFBZixLQUF3QixPQUE1QixFQUFxQztBQUMxQzdCLGtCQUFXLHNDQUFxQ1UsS0FBTSxrRUFBdEQ7QUFDRCxPQUZNLE1BRUEsSUFBSWUsUUFBUWYsS0FBUixFQUFlbUIsSUFBZixLQUF3QixlQUE1QixFQUE2QztBQUNsRDdCLGtCQUFXLHlDQUF3Q1UsS0FBTSxPQUFNZSxRQUFRZixLQUFSLEVBQWVzQixLQUFNLGtFQUFwRjtBQUNEO0FBQ0YsS0FSRDtBQVNBO0FBQ0FoQyxjQUFVLGdDQUFWO0FBQ0EwQixXQUFPQyxJQUFQLENBQVlGLE9BQVosRUFBcUJHLE9BQXJCLENBQTZCLFVBQUNsQixLQUFELEVBQVc7QUFDdEMsVUFBSWUsUUFBUWYsS0FBUixFQUFlbUIsSUFBZixLQUF3QixXQUE1QixFQUF5QztBQUN2QzdCLGtCQUFXLDJCQUEwQlUsS0FBTSwwQ0FBeUNlLFFBQVFmLEtBQVIsRUFBZWlCLElBQWYsQ0FBb0IsQ0FBcEIsQ0FBdUIsNkVBQTRFakIsS0FBTSxpQ0FBN0w7QUFDRCxPQUZELE1BRU8sSUFBSWUsUUFBUWYsS0FBUixFQUFlbUIsSUFBZixLQUF3QixPQUE1QixFQUFxQztBQUMxQzdCLGtCQUFXLDJCQUEwQlUsS0FBTSwwQ0FBeUNlLFFBQVFmLEtBQVIsRUFBZWlCLElBQWYsQ0FBb0IsQ0FBcEIsQ0FBdUIsNkVBQTRFakIsS0FBTSxpQ0FBN0w7QUFDRCxPQUZNLE1BRUEsSUFBSWUsUUFBUWYsS0FBUixFQUFlbUIsSUFBZixLQUF3QixlQUE1QixFQUE2QztBQUNsRDdCLGtCQUFXLGdEQUErQ3lCLFFBQVFmLEtBQVIsRUFBZXNCLEtBQU0sUUFBT3RCLEtBQU0sa0hBQWlIZSxRQUFRZixLQUFSLEVBQWVzQixLQUFNLFFBQU90QixLQUFNLGlDQUEvTztBQUNEO0FBQ0YsS0FSRDtBQVNBVixjQUFVLGdCQUFWO0FBQ0E7QUFDQTBCLFdBQU9DLElBQVAsQ0FBWUYsT0FBWixFQUFxQkcsT0FBckIsQ0FBNkIsVUFBQ2xCLEtBQUQsRUFBVztBQUN0QyxVQUFJZSxRQUFRZixLQUFSLEVBQWVtQixJQUFmLEtBQXdCLFdBQTVCLEVBQXlDO0FBQ3ZDN0Isa0JBQVcsc0NBQXFDVSxLQUFNLHlDQUF0RDtBQUNELE9BRkQsTUFFTyxJQUFJZSxRQUFRZixLQUFSLEVBQWVtQixJQUFmLEtBQXdCLE9BQTVCLEVBQXFDO0FBQzFDN0Isa0JBQVcsc0NBQXFDVSxLQUFNLHlDQUF0RDtBQUNELE9BRk0sTUFFQSxJQUFJZSxRQUFRZixLQUFSLEVBQWVtQixJQUFmLEtBQXdCLGVBQTVCLEVBQTZDO0FBQ2xEN0Isa0JBQVcseUNBQXdDVSxLQUFNLE9BQU1lLFFBQVFmLEtBQVIsRUFBZXNCLEtBQU0seUNBQXBGO0FBQ0Q7QUFDRixLQVJEO0FBU0EsU0FBS3RDLE9BQUwsQ0FBYW9CLE9BQWIsQ0FBcUJkLE1BQXJCLEVBQTZCQyxRQUE3QixFQUF1QyxVQUFDYyxHQUFELEVBQU1DLE9BQU4sRUFBa0I7QUFDdkQsVUFBSUQsR0FBSixFQUFTO0FBQ1BoQixpQkFBU2dCLEdBQVQ7QUFDQTtBQUNEOztBQUVEaEIsZUFBUyxJQUFULEVBQWVpQixPQUFmO0FBQ0QsS0FQRDtBQVFELEdBMUsyQjs7QUE0SzVCbUIsY0FBWXJDLFNBQVosRUFBdUIwQixXQUF2QixFQUFvQ1ksV0FBcEMsRUFBaURyQyxRQUFqRCxFQUEyRDtBQUFBOztBQUN6RFYsVUFBTSxpQ0FBTixFQUF5Q21DLFdBQXpDO0FBQ0EsUUFBSXhCLFNBQVU7Ozs7O0tBQWQ7QUFNQSxRQUFNQyxXQUFXO0FBQ2ZILGVBRGU7QUFFZjBCO0FBRmUsS0FBakI7QUFJQUUsV0FBT0MsSUFBUCxDQUFZUyxZQUFZQyxTQUF4QixFQUFtQ1QsT0FBbkMsQ0FBMkMsVUFBQ1UsUUFBRCxFQUFjO0FBQ3ZEdEMsZ0JBQVc7dUNBQ3NCc0MsUUFBUywyQkFBMEJBLFFBQVMsbUJBQWtCRixZQUFZQyxTQUFaLENBQXNCQyxRQUF0QixDQUFnQztPQUQvSDtBQUdELEtBSkQ7QUFLQVosV0FBT0MsSUFBUCxDQUFZUyxZQUFZRyxVQUF4QixFQUFvQ1gsT0FBcEMsQ0FBNEMsVUFBQ1ksUUFBRCxFQUFjO0FBQ3hEeEMsZ0JBQVc7eUNBQ3dCd0MsUUFBUyw2QkFBNEJBLFFBQVMsZUFBY0osWUFBWUcsVUFBWixDQUF1QkMsUUFBdkIsRUFBaUNYLElBQUssbUNBQWtDTyxZQUFZRyxVQUFaLENBQXVCQyxRQUF2QixFQUFpQ0MsV0FBWTtPQURwTjtBQUdELEtBSkQ7QUFLQXpDLGNBQVUsZ0JBQVY7QUFDQSxTQUFLTixPQUFMLENBQWFvQixPQUFiLENBQXFCZCxNQUFyQixFQUE2QkMsUUFBN0IsRUFBdUMsVUFBQ2MsR0FBRCxFQUFNQyxPQUFOLEVBQWtCO0FBQ3ZELFVBQUlELEdBQUosRUFBUztBQUNQaEIsaUJBQVNnQixHQUFUO0FBQ0E7QUFDRDs7QUFFRCxVQUFJVyxPQUFPQyxJQUFQLENBQVlTLFlBQVlYLE9BQXhCLEVBQWlDaUIsTUFBakMsR0FBMEMsQ0FBOUMsRUFBaUQ7QUFDL0MsZUFBS25CLFdBQUwsQ0FBaUJ6QixTQUFqQixFQUE0QjBCLFdBQTVCLEVBQXlDWSxZQUFZWCxPQUFyRCxFQUE4RDFCLFFBQTlEO0FBQ0E7QUFDRDs7QUFFREEsZUFBUyxJQUFULEVBQWVpQixPQUFmO0FBQ0QsS0FaRDtBQWFEO0FBaE4yQixDQUE5Qjs7QUFtTkEyQixPQUFPQyxPQUFQLEdBQWlCdEQsaUJBQWpCIiwiZmlsZSI6ImphbnVzZ3JhcGguanMiLCJzb3VyY2VzQ29udGVudCI6WyJjb25zdCBfID0gcmVxdWlyZSgnbG9kYXNoJyk7XG5jb25zdCBkZWJ1ZyA9IHJlcXVpcmUoJ2RlYnVnJykoJ2V4cHJlc3MtY2Fzc2FuZHJhJyk7XG5cbmNvbnN0IEphbnVzR3JhcGhCdWlsZGVyID0gZnVuY3Rpb24gZihjbGllbnQsIGNvbmZpZykge1xuICB0aGlzLl9jbGllbnQgPSBjbGllbnQ7XG4gIHRoaXMuX2NvbmZpZyA9IGNvbmZpZztcbn07XG5cbkphbnVzR3JhcGhCdWlsZGVyLnByb3RvdHlwZSA9IHtcbiAgY3JlYXRlX2dyYXBoKGdyYXBoTmFtZSwgY2FsbGJhY2spIHtcbiAgICBkZWJ1ZygnY3JlYXRpbmcgamFudXMgZ3JhcGg6ICVzJywgZ3JhcGhOYW1lKTtcbiAgICBjb25zdCBzY3JpcHQgPSBgXG4gICAgICBNYXA8U3RyaW5nLCBPYmplY3Q+IG1hcCA9IG5ldyBIYXNoTWFwPFN0cmluZywgT2JqZWN0PigpO1xuICAgICAgbWFwLnB1dChcInN0b3JhZ2UuYmFja2VuZFwiLCBzdG9yYWdlQmFja2VuZCk7XG4gICAgICBtYXAucHV0KFwic3RvcmFnZS5ob3N0bmFtZVwiLCBzdG9yYWdlSG9zdG5hbWUpO1xuICAgICAgbWFwLnB1dChcInN0b3JhZ2UucG9ydFwiLCBzdG9yYWdlUG9ydCk7XG4gICAgICBtYXAucHV0KFwiaW5kZXguc2VhcmNoLmJhY2tlbmRcIiwgaW5kZXhCYWNrZW5kKTtcbiAgICAgIG1hcC5wdXQoXCJpbmRleC5zZWFyY2guaG9zdG5hbWVcIiwgaW5kZXhIb3N0bmFtZSk7XG4gICAgICBtYXAucHV0KFwiaW5kZXguc2VhcmNoLnBvcnRcIiwgaW5kZXhQb3J0KTtcbiAgICAgIG1hcC5wdXQoXCJncmFwaC5ncmFwaG5hbWVcIiwgZ3JhcGhOYW1lKTtcbiAgICAgIENvbmZpZ3VyZWRHcmFwaEZhY3RvcnkuY3JlYXRlQ29uZmlndXJhdGlvbihuZXcgTWFwQ29uZmlndXJhdGlvbihtYXApKTtcbiAgICAgIENvbmZpZ3VyZWRHcmFwaEZhY3Rvcnkub3BlbihncmFwaE5hbWUpLnZlcnRpY2VzKCkuc2l6ZSgpO1xuICAgIGA7XG4gICAgY29uc3QgYmluZGluZ3MgPSB7XG4gICAgICBzdG9yYWdlQmFja2VuZDogdGhpcy5fY29uZmlnLnN0b3JhZ2UuYmFja2VuZCxcbiAgICAgIHN0b3JhZ2VIb3N0bmFtZTogdGhpcy5fY29uZmlnLnN0b3JhZ2UuaG9zdG5hbWUsXG4gICAgICBzdG9yYWdlUG9ydDogdGhpcy5fY29uZmlnLnN0b3JhZ2UucG9ydCxcbiAgICAgIGluZGV4QmFja2VuZDogdGhpcy5fY29uZmlnLmluZGV4LnNlYXJjaC5iYWNrZW5kLFxuICAgICAgaW5kZXhIb3N0bmFtZTogdGhpcy5fY29uZmlnLmluZGV4LnNlYXJjaC5ob3N0bmFtZSxcbiAgICAgIGluZGV4UG9ydDogdGhpcy5fY29uZmlnLmluZGV4LnNlYXJjaC5wb3J0LFxuICAgICAgZ3JhcGhOYW1lLFxuICAgIH07XG4gICAgdGhpcy5fY2xpZW50LmV4ZWN1dGUoc2NyaXB0LCBiaW5kaW5ncywgKGVyciwgcmVzdWx0cykgPT4ge1xuICAgICAgaWYgKGVycikge1xuICAgICAgICBjYWxsYmFjayhlcnIpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGNhbGxiYWNrKG51bGwsIHJlc3VsdHMpO1xuICAgIH0pO1xuICB9LFxuXG4gIGNoZWNrX2dyYXBoX2V4aXN0KGdyYXBoTmFtZSwgY2FsbGJhY2spIHtcbiAgICBkZWJ1ZygnY2hlY2sgZm9yIGphbnVzIGdyYXBoOiAlcycsIGdyYXBoTmFtZSk7XG4gICAgY29uc3Qgc2NyaXB0ID0gYFxuICAgICAgQ29uZmlndXJlZEdyYXBoRmFjdG9yeS5nZXRHcmFwaE5hbWVzKCk7XG4gICAgYDtcbiAgICBjb25zdCBiaW5kaW5ncyA9IHt9O1xuICAgIHRoaXMuX2NsaWVudC5leGVjdXRlKHNjcmlwdCwgYmluZGluZ3MsIChlcnIsIHJlc3VsdHMpID0+IHtcbiAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgY2FsbGJhY2soZXJyKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAoXy5pc0FycmF5KHJlc3VsdHMpICYmIHJlc3VsdHMuaW5jbHVkZXMoZ3JhcGhOYW1lKSkge1xuICAgICAgICBjYWxsYmFjayhudWxsLCB0cnVlKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgY2FsbGJhY2sobnVsbCwgZmFsc2UpO1xuICAgIH0pO1xuICB9LFxuXG4gIGFzc2VydF9ncmFwaChncmFwaE5hbWUsIGNhbGxiYWNrKSB7XG4gICAgdGhpcy5jaGVja19ncmFwaF9leGlzdChncmFwaE5hbWUsIChlcnIsIGV4aXN0KSA9PiB7XG4gICAgICBpZiAoZXJyKSB7XG4gICAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKCFleGlzdCkge1xuICAgICAgICB0aGlzLmNyZWF0ZV9ncmFwaChncmFwaE5hbWUsIGNhbGxiYWNrKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBjYWxsYmFjaygpO1xuICAgIH0pO1xuICB9LFxuXG4gIGRyb3BfZ3JhcGgoZ3JhcGhOYW1lLCBjYWxsYmFjaykge1xuICAgIGRlYnVnKCdyZW1vdmluZyBqYW51cyBncmFwaDogJXMnLCBncmFwaE5hbWUpO1xuICAgIGNvbnN0IHNjcmlwdCA9IGBcbiAgICAgIENvbmZpZ3VyZWRHcmFwaEZhY3RvcnkuZHJvcChncmFwaE5hbWUpO1xuICAgIGA7XG4gICAgY29uc3QgYmluZGluZ3MgPSB7XG4gICAgICBncmFwaE5hbWUsXG4gICAgfTtcbiAgICB0aGlzLl9jbGllbnQuZXhlY3V0ZShzY3JpcHQsIGJpbmRpbmdzLCAoZXJyLCByZXN1bHRzKSA9PiB7XG4gICAgICBpZiAoZXJyKSB7XG4gICAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgY2FsbGJhY2sobnVsbCwgcmVzdWx0cyk7XG4gICAgfSk7XG4gIH0sXG5cbiAgcHV0X2luZGV4ZXMoZ3JhcGhOYW1lLCBtYXBwaW5nTmFtZSwgaW5kZXhlcywgY2FsbGJhY2spIHtcbiAgICBkZWJ1Zygnc3luY2luZyBqYW51cyBncmFwaCBpbmRleGVzIGZvcjogJXMnLCBtYXBwaW5nTmFtZSk7XG4gICAgbGV0IHNjcmlwdCA9IGBcbiAgICAgIGdyYXBoID0gQ29uZmlndXJlZEdyYXBoRmFjdG9yeS5vcGVuKGdyYXBoTmFtZSk7XG4gICAgICBncmFwaC50eCgpLmNvbW1pdCgpO1xuICAgICAgbWdtdCA9IGdyYXBoLm9wZW5NYW5hZ2VtZW50KCk7XG4gICAgYDtcbiAgICBjb25zdCBiaW5kaW5ncyA9IHtcbiAgICAgIGdyYXBoTmFtZSxcbiAgICB9O1xuICAgIC8vIGNyZWF0ZSBpbmRleGVzIGlmIG5vdCBleGlzdFxuICAgIE9iamVjdC5rZXlzKGluZGV4ZXMpLmZvckVhY2goKGluZGV4KSA9PiB7XG4gICAgICBpZiAoaW5kZXhlc1tpbmRleF0udHlwZSA9PT0gJ0NvbXBvc2l0ZScpIHtcbiAgICAgICAgc2NyaXB0ICs9IGBpZiAoIW1nbXQuY29udGFpbnNHcmFwaEluZGV4KCcke2luZGV4fScpKSBtZ210LmJ1aWxkSW5kZXgoJyR7aW5kZXh9JywgVmVydGV4LmNsYXNzKWA7XG4gICAgICAgIGluZGV4ZXNbaW5kZXhdLmtleXMuZm9yRWFjaCgoa2V5KSA9PiB7XG4gICAgICAgICAgc2NyaXB0ICs9IGAuYWRkS2V5KG1nbXQuZ2V0UHJvcGVydHlLZXkoJyR7a2V5fScpKWA7XG4gICAgICAgIH0pO1xuICAgICAgICBzY3JpcHQgKz0gYC5pbmRleE9ubHkobWdtdC5nZXRWZXJ0ZXhMYWJlbCgnJHttYXBwaW5nTmFtZX0nKSlgO1xuICAgICAgICBpZiAoaW5kZXhlc1tpbmRleF0udW5pcXVlKSB7XG4gICAgICAgICAgc2NyaXB0ICs9ICcudW5pcXVlKCknO1xuICAgICAgICB9XG4gICAgICAgIHNjcmlwdCArPSAnLmJ1aWxkQ29tcG9zaXRlSW5kZXgoKTsnO1xuICAgICAgfSBlbHNlIGlmIChpbmRleGVzW2luZGV4XS50eXBlID09PSAnTWl4ZWQnKSB7XG4gICAgICAgIHNjcmlwdCArPSBgaWYgKCFtZ210LmNvbnRhaW5zR3JhcGhJbmRleCgnJHtpbmRleH0nKSkgbWdtdC5idWlsZEluZGV4KCcke2luZGV4fScsIFZlcnRleC5jbGFzcylgO1xuICAgICAgICBpbmRleGVzW2luZGV4XS5rZXlzLmZvckVhY2goKGtleSkgPT4ge1xuICAgICAgICAgIHNjcmlwdCArPSBgLmFkZEtleShtZ210LmdldFByb3BlcnR5S2V5KCcke2tleX0nKSlgO1xuICAgICAgICB9KTtcbiAgICAgICAgc2NyaXB0ICs9IGAuaW5kZXhPbmx5KG1nbXQuZ2V0VmVydGV4TGFiZWwoJyR7bWFwcGluZ05hbWV9JykpYDtcbiAgICAgICAgaWYgKGluZGV4ZXNbaW5kZXhdLnVuaXF1ZSkge1xuICAgICAgICAgIHNjcmlwdCArPSAnLnVuaXF1ZSgpJztcbiAgICAgICAgfVxuICAgICAgICBzY3JpcHQgKz0gJy5idWlsZE1peGVkSW5kZXgoXCJzZWFyY2hcIik7JztcbiAgICAgIH0gZWxzZSBpZiAoaW5kZXhlc1tpbmRleF0udHlwZSA9PT0gJ1ZlcnRleENlbnRyaWMnKSB7XG4gICAgICAgIHNjcmlwdCArPSBgcmVsYXRpb25MYWJlbCA9IG1nbXQuZ2V0RWRnZUxhYmVsKCcke2luZGV4ZXNbaW5kZXhdLmxhYmVsfScpO2A7XG4gICAgICAgIHNjcmlwdCArPSBgaWYgKCFtZ210LmNvbnRhaW5zUmVsYXRpb25JbmRleChyZWxhdGlvbkxhYmVsLCAnJHtpbmRleH0nKSkgbWdtdC5idWlsZEVkZ2VJbmRleChyZWxhdGlvbkxhYmVsLCAnJHtpbmRleH0nLCBEaXJlY3Rpb24uJHtpbmRleGVzW2luZGV4XS5kaXJlY3Rpb259LCBPcmRlci4ke2luZGV4ZXNbaW5kZXhdLm9yZGVyfWA7XG4gICAgICAgIGluZGV4ZXNbaW5kZXhdLmtleXMuZm9yRWFjaCgoa2V5KSA9PiB7XG4gICAgICAgICAgc2NyaXB0ICs9IGAsIG1nbXQuZ2V0UHJvcGVydHlLZXkoJyR7a2V5fScpYDtcbiAgICAgICAgfSk7XG4gICAgICAgIHNjcmlwdCArPSAnKTsnO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHNjcmlwdCArPSAnbWdtdC5jb21taXQoKTsnO1xuICAgIC8vIGF3YWl0IGluZGV4IGZvciByZWdpc3RlcmVkIG9yIGVuYWJsZWQgc3RhdHVzXG4gICAgT2JqZWN0LmtleXMoaW5kZXhlcykuZm9yRWFjaCgoaW5kZXgpID0+IHtcbiAgICAgIGlmIChpbmRleGVzW2luZGV4XS50eXBlID09PSAnQ29tcG9zaXRlJykge1xuICAgICAgICBzY3JpcHQgKz0gYG1nbXQuYXdhaXRHcmFwaEluZGV4U3RhdHVzKGdyYXBoLCAnJHtpbmRleH0nKS5zdGF0dXMoU2NoZW1hU3RhdHVzLlJFR0lTVEVSRUQsIFNjaGVtYVN0YXR1cy5FTkFCTEVEKS5jYWxsKCk7YDtcbiAgICAgIH0gZWxzZSBpZiAoaW5kZXhlc1tpbmRleF0udHlwZSA9PT0gJ01peGVkJykge1xuICAgICAgICBzY3JpcHQgKz0gYG1nbXQuYXdhaXRHcmFwaEluZGV4U3RhdHVzKGdyYXBoLCAnJHtpbmRleH0nKS5zdGF0dXMoU2NoZW1hU3RhdHVzLlJFR0lTVEVSRUQsIFNjaGVtYVN0YXR1cy5FTkFCTEVEKS5jYWxsKCk7YDtcbiAgICAgIH0gZWxzZSBpZiAoaW5kZXhlc1tpbmRleF0udHlwZSA9PT0gJ1ZlcnRleENlbnRyaWMnKSB7XG4gICAgICAgIHNjcmlwdCArPSBgbWdtdC5hd2FpdFJlbGF0aW9uSW5kZXhTdGF0dXMoZ3JhcGgsICcke2luZGV4fScsICcke2luZGV4ZXNbaW5kZXhdLmxhYmVsfScpLnN0YXR1cyhTY2hlbWFTdGF0dXMuUkVHSVNURVJFRCwgU2NoZW1hU3RhdHVzLkVOQUJMRUQpLmNhbGwoKTtgO1xuICAgICAgfVxuICAgIH0pO1xuICAgIC8vIGVuYWJsZSBpbmRleCBpZiBpbiByZWdpc3RlcmVkIHN0YXRlXG4gICAgc2NyaXB0ICs9ICdtZ210ID0gZ3JhcGgub3Blbk1hbmFnZW1lbnQoKTsnO1xuICAgIE9iamVjdC5rZXlzKGluZGV4ZXMpLmZvckVhY2goKGluZGV4KSA9PiB7XG4gICAgICBpZiAoaW5kZXhlc1tpbmRleF0udHlwZSA9PT0gJ0NvbXBvc2l0ZScpIHtcbiAgICAgICAgc2NyaXB0ICs9IGBpZiAobWdtdC5nZXRHcmFwaEluZGV4KCcke2luZGV4fScpLmdldEluZGV4U3RhdHVzKG1nbXQuZ2V0UHJvcGVydHlLZXkoJyR7aW5kZXhlc1tpbmRleF0ua2V5c1swXX0nKSkuZXF1YWxzKFNjaGVtYVN0YXR1cy5SRUdJU1RFUkVEKSkgbWdtdC51cGRhdGVJbmRleChtZ210LmdldEdyYXBoSW5kZXgoJyR7aW5kZXh9JyksIFNjaGVtYUFjdGlvbi5FTkFCTEVfSU5ERVgpO2A7XG4gICAgICB9IGVsc2UgaWYgKGluZGV4ZXNbaW5kZXhdLnR5cGUgPT09ICdNaXhlZCcpIHtcbiAgICAgICAgc2NyaXB0ICs9IGBpZiAobWdtdC5nZXRHcmFwaEluZGV4KCcke2luZGV4fScpLmdldEluZGV4U3RhdHVzKG1nbXQuZ2V0UHJvcGVydHlLZXkoJyR7aW5kZXhlc1tpbmRleF0ua2V5c1swXX0nKSkuZXF1YWxzKFNjaGVtYVN0YXR1cy5SRUdJU1RFUkVEKSkgbWdtdC51cGRhdGVJbmRleChtZ210LmdldEdyYXBoSW5kZXgoJyR7aW5kZXh9JyksIFNjaGVtYUFjdGlvbi5FTkFCTEVfSU5ERVgpO2A7XG4gICAgICB9IGVsc2UgaWYgKGluZGV4ZXNbaW5kZXhdLnR5cGUgPT09ICdWZXJ0ZXhDZW50cmljJykge1xuICAgICAgICBzY3JpcHQgKz0gYGlmIChtZ210LmdldFJlbGF0aW9uSW5kZXgobWdtdC5nZXRFZGdlTGFiZWwoJyR7aW5kZXhlc1tpbmRleF0ubGFiZWx9JyksICcke2luZGV4fScpLmdldEluZGV4U3RhdHVzKCkuZXF1YWxzKFNjaGVtYVN0YXR1cy5SRUdJU1RFUkVEKSkgbWdtdC51cGRhdGVJbmRleChtZ210LmdldFJlbGF0aW9uSW5kZXgobWdtdC5nZXRFZGdlTGFiZWwoJyR7aW5kZXhlc1tpbmRleF0ubGFiZWx9JyksICcke2luZGV4fScpLCBTY2hlbWFBY3Rpb24uRU5BQkxFX0lOREVYKTtgO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHNjcmlwdCArPSAnbWdtdC5jb21taXQoKTsnO1xuICAgIC8vIGF3YWl0IGluZGV4IGZvciBlbmFibGVkIHN0YXR1c1xuICAgIE9iamVjdC5rZXlzKGluZGV4ZXMpLmZvckVhY2goKGluZGV4KSA9PiB7XG4gICAgICBpZiAoaW5kZXhlc1tpbmRleF0udHlwZSA9PT0gJ0NvbXBvc2l0ZScpIHtcbiAgICAgICAgc2NyaXB0ICs9IGBtZ210LmF3YWl0R3JhcGhJbmRleFN0YXR1cyhncmFwaCwgJyR7aW5kZXh9Jykuc3RhdHVzKFNjaGVtYVN0YXR1cy5FTkFCTEVEKS5jYWxsKCk7YDtcbiAgICAgIH0gZWxzZSBpZiAoaW5kZXhlc1tpbmRleF0udHlwZSA9PT0gJ01peGVkJykge1xuICAgICAgICBzY3JpcHQgKz0gYG1nbXQuYXdhaXRHcmFwaEluZGV4U3RhdHVzKGdyYXBoLCAnJHtpbmRleH0nKS5zdGF0dXMoU2NoZW1hU3RhdHVzLkVOQUJMRUQpLmNhbGwoKTtgO1xuICAgICAgfSBlbHNlIGlmIChpbmRleGVzW2luZGV4XS50eXBlID09PSAnVmVydGV4Q2VudHJpYycpIHtcbiAgICAgICAgc2NyaXB0ICs9IGBtZ210LmF3YWl0UmVsYXRpb25JbmRleFN0YXR1cyhncmFwaCwgJyR7aW5kZXh9JywgJyR7aW5kZXhlc1tpbmRleF0ubGFiZWx9Jykuc3RhdHVzKFNjaGVtYVN0YXR1cy5FTkFCTEVEKS5jYWxsKCk7YDtcbiAgICAgIH1cbiAgICB9KTtcbiAgICB0aGlzLl9jbGllbnQuZXhlY3V0ZShzY3JpcHQsIGJpbmRpbmdzLCAoZXJyLCByZXN1bHRzKSA9PiB7XG4gICAgICBpZiAoZXJyKSB7XG4gICAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgY2FsbGJhY2sobnVsbCwgcmVzdWx0cyk7XG4gICAgfSk7XG4gIH0sXG5cbiAgcHV0X21hcHBpbmcoZ3JhcGhOYW1lLCBtYXBwaW5nTmFtZSwgbWFwcGluZ0JvZHksIGNhbGxiYWNrKSB7XG4gICAgZGVidWcoJ3N5bmNpbmcgamFudXMgZ3JhcGggbWFwcGluZzogJXMnLCBtYXBwaW5nTmFtZSk7XG4gICAgbGV0IHNjcmlwdCA9IGBcbiAgICAgIGdyYXBoID0gQ29uZmlndXJlZEdyYXBoRmFjdG9yeS5vcGVuKGdyYXBoTmFtZSk7XG4gICAgICBncmFwaC50eCgpLmNvbW1pdCgpO1xuICAgICAgbWdtdCA9IGdyYXBoLm9wZW5NYW5hZ2VtZW50KCk7XG4gICAgICBpZiAoIW1nbXQuY29udGFpbnNWZXJ0ZXhMYWJlbChtYXBwaW5nTmFtZSkpIG1nbXQubWFrZVZlcnRleExhYmVsKG1hcHBpbmdOYW1lKS5tYWtlKCk7XG4gICAgYDtcbiAgICBjb25zdCBiaW5kaW5ncyA9IHtcbiAgICAgIGdyYXBoTmFtZSxcbiAgICAgIG1hcHBpbmdOYW1lLFxuICAgIH07XG4gICAgT2JqZWN0LmtleXMobWFwcGluZ0JvZHkucmVsYXRpb25zKS5mb3JFYWNoKChyZWxhdGlvbikgPT4ge1xuICAgICAgc2NyaXB0ICs9IGBcbiAgICAgICAgaWYgKCFtZ210LmNvbnRhaW5zRWRnZUxhYmVsKCcke3JlbGF0aW9ufScpKSBtZ210Lm1ha2VFZGdlTGFiZWwoJyR7cmVsYXRpb259JykubXVsdGlwbGljaXR5KCR7bWFwcGluZ0JvZHkucmVsYXRpb25zW3JlbGF0aW9uXX0pLm1ha2UoKTtcbiAgICAgIGA7XG4gICAgfSk7XG4gICAgT2JqZWN0LmtleXMobWFwcGluZ0JvZHkucHJvcGVydGllcykuZm9yRWFjaCgocHJvcGVydHkpID0+IHtcbiAgICAgIHNjcmlwdCArPSBgXG4gICAgICAgIGlmICghbWdtdC5jb250YWluc1Byb3BlcnR5S2V5KCcke3Byb3BlcnR5fScpKSBtZ210Lm1ha2VQcm9wZXJ0eUtleSgnJHtwcm9wZXJ0eX0nKS5kYXRhVHlwZSgke21hcHBpbmdCb2R5LnByb3BlcnRpZXNbcHJvcGVydHldLnR5cGV9LmNsYXNzKS5jYXJkaW5hbGl0eShDYXJkaW5hbGl0eS4ke21hcHBpbmdCb2R5LnByb3BlcnRpZXNbcHJvcGVydHldLmNhcmRpbmFsaXR5fSkubWFrZSgpO1xuICAgICAgYDtcbiAgICB9KTtcbiAgICBzY3JpcHQgKz0gJ21nbXQuY29tbWl0KCk7JztcbiAgICB0aGlzLl9jbGllbnQuZXhlY3V0ZShzY3JpcHQsIGJpbmRpbmdzLCAoZXJyLCByZXN1bHRzKSA9PiB7XG4gICAgICBpZiAoZXJyKSB7XG4gICAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKE9iamVjdC5rZXlzKG1hcHBpbmdCb2R5LmluZGV4ZXMpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgdGhpcy5wdXRfaW5kZXhlcyhncmFwaE5hbWUsIG1hcHBpbmdOYW1lLCBtYXBwaW5nQm9keS5pbmRleGVzLCBjYWxsYmFjayk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgY2FsbGJhY2sobnVsbCwgcmVzdWx0cyk7XG4gICAgfSk7XG4gIH0sXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEphbnVzR3JhcGhCdWlsZGVyO1xuIl19