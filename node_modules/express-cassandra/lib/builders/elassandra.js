'use strict';

var debug = require('debug')('express-cassandra');

var ElassandraBuilder = function f(client) {
  this._client = client;
};

ElassandraBuilder.prototype = {
  create_index(keyspaceName, indexName, callback) {
    debug('creating elassandra index: %s', indexName);
    this._client.indices.create({
      index: indexName,
      body: {
        settings: {
          keyspace: keyspaceName
        }
      }
    }, function (err) {
      if (err) {
        callback(err);
        return;
      }

      callback();
    });
  },

  check_index_exist(indexName, callback) {
    debug('check for elassandra index: %s', indexName);
    this._client.indices.exists({ index: indexName }, function (err, res) {
      if (err) {
        callback(err);
        return;
      }

      callback(null, res);
    });
  },

  assert_index(keyspaceName, indexName, callback) {
    var _this = this;

    this.check_index_exist(indexName, function (err, exist) {
      if (err) {
        callback(err);
        return;
      }

      if (!exist) {
        _this.create_index(keyspaceName, indexName, callback);
        return;
      }

      callback();
    });
  },

  delete_index(indexName, callback) {
    debug('removing elassandra index: %s', indexName);
    this._client.indices.delete({
      index: indexName
    }, function (err) {
      if (err) {
        callback(err);
        return;
      }

      callback();
    });
  },

  put_mapping(indexName, mappingName, mappingBody, callback) {
    debug('syncing elassandra mapping: %s', mappingName);
    this._client.indices.putMapping({
      index: indexName,
      type: mappingName,
      body: mappingBody
    }, function (err) {
      if (err) {
        callback(err);
        return;
      }

      callback();
    });
  }
};

module.exports = ElassandraBuilder;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9idWlsZGVycy9lbGFzc2FuZHJhLmpzIl0sIm5hbWVzIjpbImRlYnVnIiwicmVxdWlyZSIsIkVsYXNzYW5kcmFCdWlsZGVyIiwiZiIsImNsaWVudCIsIl9jbGllbnQiLCJwcm90b3R5cGUiLCJjcmVhdGVfaW5kZXgiLCJrZXlzcGFjZU5hbWUiLCJpbmRleE5hbWUiLCJjYWxsYmFjayIsImluZGljZXMiLCJjcmVhdGUiLCJpbmRleCIsImJvZHkiLCJzZXR0aW5ncyIsImtleXNwYWNlIiwiZXJyIiwiY2hlY2tfaW5kZXhfZXhpc3QiLCJleGlzdHMiLCJyZXMiLCJhc3NlcnRfaW5kZXgiLCJleGlzdCIsImRlbGV0ZV9pbmRleCIsImRlbGV0ZSIsInB1dF9tYXBwaW5nIiwibWFwcGluZ05hbWUiLCJtYXBwaW5nQm9keSIsInB1dE1hcHBpbmciLCJ0eXBlIiwibW9kdWxlIiwiZXhwb3J0cyJdLCJtYXBwaW5ncyI6Ijs7QUFBQSxJQUFNQSxRQUFRQyxRQUFRLE9BQVIsRUFBaUIsbUJBQWpCLENBQWQ7O0FBRUEsSUFBTUMsb0JBQW9CLFNBQVNDLENBQVQsQ0FBV0MsTUFBWCxFQUFtQjtBQUMzQyxPQUFLQyxPQUFMLEdBQWVELE1BQWY7QUFDRCxDQUZEOztBQUlBRixrQkFBa0JJLFNBQWxCLEdBQThCO0FBQzVCQyxlQUFhQyxZQUFiLEVBQTJCQyxTQUEzQixFQUFzQ0MsUUFBdEMsRUFBZ0Q7QUFDOUNWLFVBQU0sK0JBQU4sRUFBdUNTLFNBQXZDO0FBQ0EsU0FBS0osT0FBTCxDQUFhTSxPQUFiLENBQXFCQyxNQUFyQixDQUE0QjtBQUMxQkMsYUFBT0osU0FEbUI7QUFFMUJLLFlBQU07QUFDSkMsa0JBQVU7QUFDUkMsb0JBQVVSO0FBREY7QUFETjtBQUZvQixLQUE1QixFQU9HLFVBQUNTLEdBQUQsRUFBUztBQUNWLFVBQUlBLEdBQUosRUFBUztBQUNQUCxpQkFBU08sR0FBVDtBQUNBO0FBQ0Q7O0FBRURQO0FBQ0QsS0FkRDtBQWVELEdBbEIyQjs7QUFvQjVCUSxvQkFBa0JULFNBQWxCLEVBQTZCQyxRQUE3QixFQUF1QztBQUNyQ1YsVUFBTSxnQ0FBTixFQUF3Q1MsU0FBeEM7QUFDQSxTQUFLSixPQUFMLENBQWFNLE9BQWIsQ0FBcUJRLE1BQXJCLENBQTRCLEVBQUVOLE9BQU9KLFNBQVQsRUFBNUIsRUFBa0QsVUFBQ1EsR0FBRCxFQUFNRyxHQUFOLEVBQWM7QUFDOUQsVUFBSUgsR0FBSixFQUFTO0FBQ1BQLGlCQUFTTyxHQUFUO0FBQ0E7QUFDRDs7QUFFRFAsZUFBUyxJQUFULEVBQWVVLEdBQWY7QUFDRCxLQVBEO0FBUUQsR0E5QjJCOztBQWdDNUJDLGVBQWFiLFlBQWIsRUFBMkJDLFNBQTNCLEVBQXNDQyxRQUF0QyxFQUFnRDtBQUFBOztBQUM5QyxTQUFLUSxpQkFBTCxDQUF1QlQsU0FBdkIsRUFBa0MsVUFBQ1EsR0FBRCxFQUFNSyxLQUFOLEVBQWdCO0FBQ2hELFVBQUlMLEdBQUosRUFBUztBQUNQUCxpQkFBU08sR0FBVDtBQUNBO0FBQ0Q7O0FBRUQsVUFBSSxDQUFDSyxLQUFMLEVBQVk7QUFDVixjQUFLZixZQUFMLENBQWtCQyxZQUFsQixFQUFnQ0MsU0FBaEMsRUFBMkNDLFFBQTNDO0FBQ0E7QUFDRDs7QUFFREE7QUFDRCxLQVpEO0FBYUQsR0E5QzJCOztBQWdENUJhLGVBQWFkLFNBQWIsRUFBd0JDLFFBQXhCLEVBQWtDO0FBQ2hDVixVQUFNLCtCQUFOLEVBQXVDUyxTQUF2QztBQUNBLFNBQUtKLE9BQUwsQ0FBYU0sT0FBYixDQUFxQmEsTUFBckIsQ0FBNEI7QUFDMUJYLGFBQU9KO0FBRG1CLEtBQTVCLEVBRUcsVUFBQ1EsR0FBRCxFQUFTO0FBQ1YsVUFBSUEsR0FBSixFQUFTO0FBQ1BQLGlCQUFTTyxHQUFUO0FBQ0E7QUFDRDs7QUFFRFA7QUFDRCxLQVREO0FBVUQsR0E1RDJCOztBQThENUJlLGNBQVloQixTQUFaLEVBQXVCaUIsV0FBdkIsRUFBb0NDLFdBQXBDLEVBQWlEakIsUUFBakQsRUFBMkQ7QUFDekRWLFVBQU0sZ0NBQU4sRUFBd0MwQixXQUF4QztBQUNBLFNBQUtyQixPQUFMLENBQWFNLE9BQWIsQ0FBcUJpQixVQUFyQixDQUFnQztBQUM5QmYsYUFBT0osU0FEdUI7QUFFOUJvQixZQUFNSCxXQUZ3QjtBQUc5QlosWUFBTWE7QUFId0IsS0FBaEMsRUFJRyxVQUFDVixHQUFELEVBQVM7QUFDVixVQUFJQSxHQUFKLEVBQVM7QUFDUFAsaUJBQVNPLEdBQVQ7QUFDQTtBQUNEOztBQUVEUDtBQUNELEtBWEQ7QUFZRDtBQTVFMkIsQ0FBOUI7O0FBK0VBb0IsT0FBT0MsT0FBUCxHQUFpQjdCLGlCQUFqQiIsImZpbGUiOiJlbGFzc2FuZHJhLmpzIiwic291cmNlc0NvbnRlbnQiOlsiY29uc3QgZGVidWcgPSByZXF1aXJlKCdkZWJ1ZycpKCdleHByZXNzLWNhc3NhbmRyYScpO1xuXG5jb25zdCBFbGFzc2FuZHJhQnVpbGRlciA9IGZ1bmN0aW9uIGYoY2xpZW50KSB7XG4gIHRoaXMuX2NsaWVudCA9IGNsaWVudDtcbn07XG5cbkVsYXNzYW5kcmFCdWlsZGVyLnByb3RvdHlwZSA9IHtcbiAgY3JlYXRlX2luZGV4KGtleXNwYWNlTmFtZSwgaW5kZXhOYW1lLCBjYWxsYmFjaykge1xuICAgIGRlYnVnKCdjcmVhdGluZyBlbGFzc2FuZHJhIGluZGV4OiAlcycsIGluZGV4TmFtZSk7XG4gICAgdGhpcy5fY2xpZW50LmluZGljZXMuY3JlYXRlKHtcbiAgICAgIGluZGV4OiBpbmRleE5hbWUsXG4gICAgICBib2R5OiB7XG4gICAgICAgIHNldHRpbmdzOiB7XG4gICAgICAgICAga2V5c3BhY2U6IGtleXNwYWNlTmFtZSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSwgKGVycikgPT4ge1xuICAgICAgaWYgKGVycikge1xuICAgICAgICBjYWxsYmFjayhlcnIpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGNhbGxiYWNrKCk7XG4gICAgfSk7XG4gIH0sXG5cbiAgY2hlY2tfaW5kZXhfZXhpc3QoaW5kZXhOYW1lLCBjYWxsYmFjaykge1xuICAgIGRlYnVnKCdjaGVjayBmb3IgZWxhc3NhbmRyYSBpbmRleDogJXMnLCBpbmRleE5hbWUpO1xuICAgIHRoaXMuX2NsaWVudC5pbmRpY2VzLmV4aXN0cyh7IGluZGV4OiBpbmRleE5hbWUgfSwgKGVyciwgcmVzKSA9PiB7XG4gICAgICBpZiAoZXJyKSB7XG4gICAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgY2FsbGJhY2sobnVsbCwgcmVzKTtcbiAgICB9KTtcbiAgfSxcblxuICBhc3NlcnRfaW5kZXgoa2V5c3BhY2VOYW1lLCBpbmRleE5hbWUsIGNhbGxiYWNrKSB7XG4gICAgdGhpcy5jaGVja19pbmRleF9leGlzdChpbmRleE5hbWUsIChlcnIsIGV4aXN0KSA9PiB7XG4gICAgICBpZiAoZXJyKSB7XG4gICAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKCFleGlzdCkge1xuICAgICAgICB0aGlzLmNyZWF0ZV9pbmRleChrZXlzcGFjZU5hbWUsIGluZGV4TmFtZSwgY2FsbGJhY2spO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGNhbGxiYWNrKCk7XG4gICAgfSk7XG4gIH0sXG5cbiAgZGVsZXRlX2luZGV4KGluZGV4TmFtZSwgY2FsbGJhY2spIHtcbiAgICBkZWJ1ZygncmVtb3ZpbmcgZWxhc3NhbmRyYSBpbmRleDogJXMnLCBpbmRleE5hbWUpO1xuICAgIHRoaXMuX2NsaWVudC5pbmRpY2VzLmRlbGV0ZSh7XG4gICAgICBpbmRleDogaW5kZXhOYW1lLFxuICAgIH0sIChlcnIpID0+IHtcbiAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgY2FsbGJhY2soZXJyKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBjYWxsYmFjaygpO1xuICAgIH0pO1xuICB9LFxuXG4gIHB1dF9tYXBwaW5nKGluZGV4TmFtZSwgbWFwcGluZ05hbWUsIG1hcHBpbmdCb2R5LCBjYWxsYmFjaykge1xuICAgIGRlYnVnKCdzeW5jaW5nIGVsYXNzYW5kcmEgbWFwcGluZzogJXMnLCBtYXBwaW5nTmFtZSk7XG4gICAgdGhpcy5fY2xpZW50LmluZGljZXMucHV0TWFwcGluZyh7XG4gICAgICBpbmRleDogaW5kZXhOYW1lLFxuICAgICAgdHlwZTogbWFwcGluZ05hbWUsXG4gICAgICBib2R5OiBtYXBwaW5nQm9keSxcbiAgICB9LCAoZXJyKSA9PiB7XG4gICAgICBpZiAoZXJyKSB7XG4gICAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgY2FsbGJhY2soKTtcbiAgICB9KTtcbiAgfSxcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gRWxhc3NhbmRyYUJ1aWxkZXI7XG4iXX0=