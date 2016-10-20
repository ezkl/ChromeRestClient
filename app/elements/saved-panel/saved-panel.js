(function() {
  'use strict';
  Polymer({
    is: 'saved-panel',
    /**
     * Fired when the user clicked on export requests button.
     *
     * @event saved-panel-export-items
     * @property {Array} items Array of items to be deleted
     */
    /**
     * Fired when the user clicked on delete request/s button.
     *
     * @event saved-panel-delete-items
     * @property {Array} items Array of items to be deleted
     */
    /**
     * Fired when the user want to open a request.
     * @event saved-panel-open-item
     * @property {String} id The doc._id of the item.
     */
    properties: {
      // Read requests data.
      savedData: {
        type: Array,
        value: []
      },
      // current query options
      queryOptions: {
        type: Object,
        readOnly: true,
        value: function() {
          return {
            limit: 50,
            descending: true,
            // jscs:disable
            include_docs: true
              // jscs:enable
          };
        }
      },
      optionsState: {
        type: Number,
        value: 0
      },
      // Selected by the user elements on the lists
      currentSelection: {
        type: Array
      },
      detailedRequest: Object,
      narrowDrawer: {
        type: Boolean,
        value: true
      },
      hasSelection: {
        type: Boolean,
        compute: '_hasSelection(currentSelection.length)'
      },
      // If set the panel will show the results matched for given query.
      searchQuery: String,
      querying: {
        type: Boolean,
        readOnly: true,
        notify: true
      },

      isEmpty: Boolean
    },

    observers: [
      '_observeSelection(hasSelection)',
      '_searchQueryChanged(searchQuery)',
      '_queryComplete(querying, savedData.length)'
    ],

    listeners: {
      'saved-list-item-name-changed': '_savedNameChangeRequested'
    },

    behaviors: [
      ArcBehaviors.ArcFileExportBehavior
    ],

    _observeSelection: function(hasSelection) {
      if (hasSelection) {
        this.optionsState = 1;
      } else {
        this.optionsState = 0;
      }
    },

    _getDb: function() {
      return new PouchDB('saved-requests');
    },

    _searchQueryChanged: function(searchQuery) {
      delete this.queryOptions.startkey;
      delete this.queryOptions.skip;
      this.set('savedData', []);
      this.query(searchQuery);
    },

    // refreshes the state of the panel.
    refresh() {
      delete this.queryOptions.startkey;
      delete this.queryOptions.skip;
      this.set('savedData', []);
      this.loadNext();
    },

    query(q) {
      if (!q) {
        return this.refresh();
      }
      let encodedQ = encodeURIComponent(q.toLowerCase());
      var db = this._getDb();
      this._setQuerying(true);
      db.allDocs().then((r) => {
        let matches = r.rows.filter((i) => i.id.indexOf(encodedQ) !== -1);
        if (!matches.length) {
          this._setQuerying(false);
          return;
        }
        var p = matches.map((i) => db.get(i.id));
        return Promise.all(p);
      })
      .then((r) => {
        this._setQuerying(false);
        if (!r) {
          return;
        }
        var ids = [];
        r.forEach((item) => {
          ids.push(item._id);
          this.push('savedData', item);
        });
        return ids;
      })
      .catch((e) => {
        this._setQuerying(false);
        this.fire('app-log', {
          message: ['Query saved', e],
          level: 'error'
        });
        console.error('Query saved', e);
      })
      .then((ids) => {
        db.close();
        this._fullSearch(q, ids);
      });
    },

    _fullSearch: function(q, ids) {
      this._setQuerying(true);

      var mm = Math.round(100 / q.split(/\s/).length);
      var db = this._getDb();
      db.search({
          query: q,
          fields: ['headers', 'payload'],
          // jscs:disable
          include_docs: true,
          // jscs:enable
          mm: mm + '%'
        }).then((r) => {
          this._setQuerying(false);
          if (!r || !r.rows || !r.rows.length) {
            return;
          }
          if (ids && ids.length) {
            r.rows = r.rows.filter((i) => ids.indexOf(i.id) === -1);
          }
          if (!r.rows.length) {
            return;
          }
          r.rows.forEach((item) => {
            this.push('savedData', item.doc);
          });
        })
        .catch((e) => {
          this._setQuerying(false);
          this.fire('app-log', {
            message: ['Query saved', e],
            level: 'error'
          });
          console.error('Query saved', e);
        })
        .then(() => {
          db.close();
        });
    },

    loadNext: function() {
      if (this.searchQuery) {
        return;
      }
      this.debounce('saved-load-page', this._loadPage, 200);
    },

    _loadPage: function() {
      if (this.searchQuery) {
        return;
      }
      var db = this._getDb();
      this._setQuerying(true);
      db.allDocs(this.queryOptions).then((response) => {
        if (response && response.rows.length > 0) {
          this.queryOptions.startkey =
            response.rows[response.rows.length - 1].key;
          this.queryOptions.skip = 1;
          let res = response.rows.map((i) => i.doc);
          res = this._processResults(res);
          res.forEach((item) => {
            this.push('savedData', item);
          });
        }
        this._setQuerying(false);
      })
      .catch((e) => {
        this._setQuerying(false);
        this.fire('app-log', {
          message: ['Query saved', e],
          level: 'error'
        });
        console.error('Query saved', e);
      })
      .then(() => {
        db.close();
      });
    },

    _processResults: function(res) {
      // sort by updated
      res.sort((a, b) => {
        if (!a.name || !b.name) {
          return 0;
        }
        return a.name.localeCompare(b.name);
      });
      res = res.filter((i) => i._id.indexOf('_design') !== 0);
      return res;
    },

    _selectionChanged: function(e) {
      var r = e.detail.item;
      if (e.detail.selected) {
        this.detailedRequest = r;
        this.narrowDrawer = false;
        this.$.details.openDrawer();
      } else {
        if (this.detailedRequest === r) {
          this.closeDetailsPanel();
          this.detailedRequest = null;
        }
      }
    },

    closeDetailsPanel: function() {
      this.narrowDrawer = true;
      this.$.details.closeDrawer();
    },

    _onOpenRequested: function(e) {
      e.preventDefault();
      e.stopPropagation();
      var url = 'request/saved/' + encodeURIComponent(e.detail.item._id);
      page(url);
    },

    _hasSelection(length) {
      return !!length;
    },

    _onDeleteRequested: function(e) {
      e.preventDefault();
      e.stopPropagation();
      this.deleteItems([e.detail.item]);
    },

    _deleteSelected: function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (!this.currentSelection ||
        !this.currentSelection.length) {
        this.$.noSelectionToast.open();
        return;
      }
      this.deleteItems(this.currentSelection);
    },

    _exportSelected: function() {
      if (!this.currentSelection ||
        !this.currentSelection.length) {
        this.$.noSelectionToast.open();
        return;
      }
      this.exportContent = arc.app.importer.createExportObject({
        requests: this.currentSelection
      });
      var date = new Date();
      var day = date.getDate();
      var year = date.getFullYear();
      var month = date.getMonth() + 1;
      this.fileSuggestedName = 'arc-export-' + day + '-' + month + '-' + year + '-saved.json';
      this.exportMime = 'json';
      this.exportData();
      arc.app.analytics.sendEvent('Engagement', 'Click', 'Export selected saved as file');
    },

    deleteItems: function(items) {
      var db = this._getDb();
      var p = items.map((i) => db.remove(i));
      Promise.all(p).then(() => {
        this.debounce('refresh-saved', () => {
          this.refresh();
        }, 200);
      }).catch((e) => {
        StatusNotification.notify({
          message: 'Error deleting entries. ' + e.message
        });
        this.fire('app-log', {
          message: ['Error deleting entries', e],
          level: e
        });
        console.error(e);
      })
      .then(() => {
        db.close();
      });
    },

    _computeOptionsTableClass: function(optionsState) {
      var clazz = 'table-options';
      clazz += (optionsState === 0 ? ' inactive' : '');
      return clazz;
    },

    _savedNameChangeRequested: function(e) {
      e.preventDefault();
      e.stopPropagation();

      var db = this._getDb();
      db.put(e.detail.item).then((r) => {
        e.detail.item._id = r.id;
        e.detail.item._rev = r.rev;
        this.savedData[e.detail.index] = e.detail.item;
      })
      .catch((e) => {
        StatusNotification.notify({
          message: 'Error deleting database. ' + e.message
        });
        this.fire('app-log', {
          message: ['Error deleting database', e],
          level: e
        });
        console.error(e);
      })
      .then(() => {
        db.close();
      });
    },

    warnClearAll: function() {
      this.$.dataClearDialog.opened = true;
    },

    onClearDialogResult: function(e, detail) {
      if (!detail.confirmed) {
        return;
      }
      var db = this._getDb();
      db.destroy()
      .catch((e) => {
        StatusNotification.notify({
          message: 'Error deleting database. ' + e.message
        });
        this.fire('app-log', {
          message: ['Error deleting database', e],
          level: e
        });
        console.error(e);
      })
      .then(() => {
        this.refresh();
      });
    },

    _queryComplete: function(querying, length) {
      var state = false;
      if (!querying && !length) {
        state = true;
      }
      this.set('isEmpty', state);
    }
  });
})();
