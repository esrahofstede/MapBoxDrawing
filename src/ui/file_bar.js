var shpwrite = require('shp-write'),
    clone = require('clone'),
    geojson2dsv = require('geojson2dsv'),
    topojson = require('topojson'),
    saveAs = require('filesaver.js'),
    tokml = require('tokml'),
    githubBrowser = require('github-file-browser'),
    gistBrowser = require('gist-map-browser'),
    geojsonNormalize = require('geojson-normalize'),
    wellknown = require('wellknown');

var share = require('./share'),
    modal = require('./modal.js'),
    flash = require('./flash'),
    zoomextent = require('../lib/zoomextent'),
    readFile = require('../lib/readfile'),
    meta = require('../lib/meta.js'),
    saver = require('../ui/saver.js'),
    config = require('../config.js')(location.hostname);

/**
 * This module provides the file picking & status bar above the map interface.
 * It dispatches to source implementations that interface with specific
 * sources, like GitHub.
 */
module.exports = function fileBar(context) {

    var shpSupport = typeof ArrayBuffer !== 'undefined';
    var mapboxAPI = /a\.tiles\.mapbox.com/.test(L.mapbox.config.HTTP_URL);
    var githubAPI = !!config.GithubAPI;
    var githubBase = githubAPI ? config.GithubAPI + '/api/v3': 'https://api.github.com';

    var exportFormats = [
        {
            title: 'GeoJSON',
            action: downloadGeoJSON
        }, {
            title: 'TopoJSON',
            action: downloadTopo
        }, {
            title: 'CSV',
            action: downloadDSV
        }, {
            title: 'KML',
            action: downloadKML
        }, {
            title: 'WKT',
            action: downloadWKT
        }];

    if (shpSupport) {
        exportFormats.push({
            title: 'Shapefile',
            action: downloadShp
        });
    }

    function bar(selection) {

        var actions = [
            {
                title: 'Save',
                action: (mapboxAPI || githubAPI) ? saveAction : function() {},
                children: exportFormats
            }, {
                title: 'New',
                action: function() {
                    window.open(window.location.origin +
                        window.location.pathname + '#new');
                }
            }, {
                title: 'Meta',
                action: function() {},
                children: [
                    {
                        title: 'Zoom naar gebied',
                        alt: 'Zoom naar een gebiedje',
                        action: function() {
                            var gebiedsnummer = prompt('gebiedsnummer)');
                            if (gebiedsnummer === null) return;
                            var coordinaten = opengebiedje(gebiedsnummer);
                            window.api.map.setView([coordinaten[0], coordinaten[1]], 14);
                        }
                    },
                    {
                        title: 'Add map layer',
                        alt: 'Add a custom tile layer',
                        action: function() {
                            var layerURL = prompt('Layer URL \n(http://tile.stamen.com/watercolor/{z}/{x}/{y}.jpg)');
                            if (layerURL === null) return;
                            var layerName = prompt('Layer name');
                            if (layerName === null) return;
                            meta.adduserlayer(context, layerURL, layerName);
                        }
                    },
                    {
                        title: 'Zoom to features',
                        alt: 'Zoom to the extent of all features',
                        action: function() {
                            meta.zoomextent(context);
                        }
                    },
                    {
                        title: 'Clear',
                        alt: 'Delete all features from the map',
                        action: function() {
                            if (confirm('Are you sure you want to delete all features from this map?')) {
                                meta.clear(context);
                            }
                        }
                    }, {
                        title: 'Random: Points',
                        alt: 'Add random points to your map',
                        action: function() {
                            var response = prompt('Number of points (default: 100)');
                            if (response === null) return;
                            var count = parseInt(response, 10);
                            if (isNaN(count)) count = 100;
                            meta.random(context, count, 'point');
                        }
                    }, {
                        title: 'Add bboxes',
                        alt: 'Add bounding box members to all applicable GeoJSON objects',
                        action: function() {
                            meta.bboxify(context);
                        }
                    }, {
                        title: 'Flatten Multi Features',
                        alt: 'Flatten MultiPolygons, MultiLines, and GeometryCollections into simple geometries',
                        action: function() {
                            meta.flatten(context);
                        }
                    }
                ]
            }];

        if (mapboxAPI || githubAPI) {
            actions.unshift({
                title: 'Open',
                children: [
                    {
                        title: 'File',
                        alt: 'GeoJSON, TopoJSON, GTFS, KML, CSV, GPX and OSM XML supported',
                        action: blindImport
                    }, {
                        title: 'GitHub',
                        alt: 'GeoJSON files in GitHub Repositories',
                        authenticated: true,
                        action: clickGitHubOpen
                    }, {
                        title: 'Gist',
                        alt: 'GeoJSON files in GitHub Gists',
                        authenticated: true,
                        action: clickGist
                    }
                ]
            });
        actions[1].children.unshift({
                title: 'GitHub',
                alt: 'GeoJSON files in GitHub Repositories',
                authenticated: true,
                action: clickGitHubSave
            }, {
                title: 'Gist',
                alt: 'GeoJSON files in GitHub Gists',
                authenticated: true,
                action: clickGistSave
            }, {
                title: 'GeofenceAPI',
                alt: 'GeoJSON files as geofences',
                authenticated: true,
                action: clickGeofenceApiSave
            });

            if (mapboxAPI) actions.splice(3, 0, {
                    title: 'Center',
                    action: function() {
                        window.api.map.setView([52.2637, 6.1888], 14);
                    }
            });
        } else {
            actions.unshift({
                title: 'Open',
                alt: 'CSV, GTFS, KML, GPX, and other filetypes',
                action: blindImport
            });
        }

        var items = selection.append('div')
            .attr('class', 'inline')
            .selectAll('div.item')
            .data(actions)
            .enter()
            .append('div')
            .attr('class', 'item');

        var buttons = items.append('a')
            .attr('class', 'parent')
            .on('click', function(d) {
                if (d.action) d.action.apply(this, d);
            })
            .text(function(d) {
                return ' ' + d.title;
            });

        items.each(function(d) {
            if (!d.children) return;
            d3.select(this)
                .append('div')
                .attr('class', 'children')
                .call(submenu(d.children));
        });

        var name = selection.append('div')
            .attr('class', 'name');

        if (mapboxAPI || githubAPI) {
            var filetype = name.append('a')
                .attr('target', '_blank')
                .attr('class', 'icon-file-alt');

            var filename = name.append('span')
                .attr('class', 'filename')
                .text('unsaved');
        }

        function clickGistSave() {
            if (d3.event) d3.event.preventDefault();
            context.data.set({ type: 'gist' });
            saver(context);
        }

        function clickGeofenceApiSave() {
            if (d3.event) d3.event.preventDefault();
            context.data.set({ type: 'geofenceapi' });
            saver(context);
        }

        function saveAction() {
            if (d3.event) d3.event.preventDefault();
            saver(context);
        }

        function sourceIcon(type) {
            if (type == 'github') return 'icon-github';
            else if (type == 'gist') return 'icon-github-alt';
            else return 'icon-file-alt';
        }

        function saveNoun(_) {
            buttons.filter(function(b) {
                return b.title === 'Save';
            }).select('span.title').text(_);
        }

        function submenu(children) {
            return function(selection) {
                selection
                    .selectAll('a')
                    .data(children)
                    .enter()
                    .append('a')
                    .attr('title', function(d) {
                        if (d.title == 'File' || d.title == 'GitHub' || d.title == 'Gist' || d.title == 'Add map layer' || d.title == 'Zoom to features' || d.title == 'Clear' || d.title == 'Random: Points' || d.title == 'Add bboxes' || d.title == 'Flatten Multi Features') return d.alt;
                    })
                    .text(function(d) {
                        return d.title;
                    })
                    .on('click', function(d) {
                        d.action.apply(this, d);
                    });
            };
        }

        context.dispatch.on('change.filebar', onchange);

        function clickGitHubOpen() {
            if (!context.user.token()) return flash(context.container, 'You must authenticate to use this API.');

            var m = modal(d3.select('div.geojsonio'));

            m.select('.m')
                .attr('class', 'modal-splash modal col6');

            m.select('.content')
                .append('div')
                .attr('class', 'header pad2 fillD')
                .append('h1')
                .text('GitHub');

            githubBrowser(context.user.token(), false, githubBase)
                .open()
                .onclick(function(d) {
                    if (!d || !d.length) return;
                    var last = d[d.length - 1];
                    if (!last.path) {
                        throw new Error('last is invalid: ' + JSON.stringify(last));
                    }
                    if (!last.path.match(/\.(geo)?json/i)) {
                        return alert('only GeoJSON files are supported from GitHub');
                    }
                    if (last.type === 'blob') {
                        githubBrowser.request('/repos/' + d[1].full_name +
                            '/git/blobs/' + last.sha, function(err, blob) {
                                d.content = JSON.parse(atob(blob[0].content));
                                context.data.parse(d);
                                zoomextent(context);
                                m.close();
                            });
                    }
                })
                .appendTo(
                    m.select('.content')
                        .append('div')
                        .attr('class', 'repos pad2')
                        .node());
        }

        function clickGitHubSave() {
            if (!context.user.token()) return flash(context.container, 'You must authenticate to use this API.');

            var m = modal(d3.select('div.geojsonio'));

            m.select('.m')
                .attr('class', 'modal-splash modal col6');

            m.select('.content')
                .append('div')
                .attr('class', 'header pad2 fillD')
                .append('h1')
                .text('GitHub');

            githubBrowser(context.user.token(), true, githubBase)
                .open()
                .onclick(function(d) {
                    if (!d || !d.length) return;
                    var last = d[d.length - 1];
                    if (last.type === 'new') {
                        var filename = prompt('New file name');
                        if (!filename) {
                            m.close();
                            return;
                        }
                        var pathparts = d.slice(3);
                        pathparts.pop();
                        pathparts.push({ path: filename });
                        var partial = pathparts.map(function(p) {
                            return p.path;
                        }).join('/');
                        context.data.set({
                            source: {
                                url: githubBase + '/repos/' +
                                    d[0].login + '/' + d[1].name +
                                        '/contents/' + partial +
                                        '?ref=' + d[2].name
                            },
                            type: 'github',
                            meta: {
                                branch: d[2].name,
                                login: d[0].login,
                                repo: d[1].name
                            }
                        });
                        context.data.set({ newpath: partial + filename });
                        m.close();
                        saver(context);
                    } else {
                        alert('overwriting existing files is not yet supported');
                    }
                })
                .appendTo(
                    m.select('.content')
                        .append('div')
                        .attr('class', 'repos pad2')
                        .node());
        }

        function clickGist() {
            if (!context.user.token()) return flash(context.container, 'You must authenticate to use this API.');

            var m = modal(d3.select('div.geojsonio'));

            m.select('.m')
                .attr('class', 'modal-splash modal col6');

            gistBrowser(context.user.token(), githubBase)
                .open()
                .onclick(function(d) {
                    context.data.parse(d);
                    zoomextent(context);
                    m.close();
                })
                .appendTo(
                    m.select('.content')
                        .append('div')
                        .attr('class', 'repos pad2')
                        .node());
        }

        function onchange(d) {
            var data = d.obj,
                type = data.type,
                path = data.path;
            if (mapboxAPI || githubAPI) filename
                .text(path ? path : 'unsaved')
                .classed('deemphasize', context.data.dirty);
            if (mapboxAPI || githubAPI) filetype
                .attr('href', data.url)
                .attr('class', sourceIcon(type));
            saveNoun(type == 'github' ? 'Commit' : 'Save');
        }

        function blindImport() {
            var put = d3.select('body')
                .append('input')
                .attr('type', 'file')
                .style('visibility', 'hidden')
                .style('position', 'absolute')
                .style('height', '0')
                .on('change', function() {
                    var files = this.files;
                    if (!(files && files[0])) return;
                    readFile.readAsText(files[0], function(err, text) {
                        readFile.readFile(files[0], text, onImport);
                        if (files[0].path) {
                            context.data.set({
                                path: files[0].path
                            });
                        }
                    });
                    put.remove();
                });
            put.node().click();
        }

        function onImport(err, gj, warning) {
            gj = geojsonNormalize(gj);
            if (gj) {
                context.data.mergeFeatures(gj.features);
                if (warning) {
                    flash(context.container, warning.message);
                } else {
                    flash(context.container, 'Imported ' + gj.features.length + ' features.')
                        .classed('success', 'true');
                }
                zoomextent(context);
            }
        }

        d3.select(document).call(
            d3.keybinding('file_bar')
                .on('⌘+o', function() {
                    blindImport();
                    d3.event.preventDefault();
                })
                .on('⌘+s', saveAction));
    }

    function downloadTopo() {
        var content = JSON.stringify(topojson.topology({
            collection: clone(context.data.get('map'))
        }, {'property-transform': allProperties}));

        saveAs(new Blob([content], {
            type: 'text/plain;charset=utf-8'
        }), 'map.topojson');

    }

    function downloadGeoJSON() {
        if (d3.event) d3.event.preventDefault();
        var content = JSON.stringify(context.data.get('map'));
        var meta = context.data.get('meta');
        saveAs(new Blob([content], {
            type: 'text/plain;charset=utf-8'
        }), (meta && meta.name) || 'map.geojson');
    }

    function downloadDSV() {
        if (d3.event) d3.event.preventDefault();
        var content = geojson2dsv(context.data.get('map'));
        saveAs(new Blob([content], {
            type: 'text/plain;charset=utf-8'
        }), 'points.csv');
    }

    function downloadKML() {
        if (d3.event) d3.event.preventDefault();
        var content = tokml(context.data.get('map'));
        var meta = context.data.get('meta');
        saveAs(new Blob([content], {
            type: 'text/plain;charset=utf-8'
        }), 'map.kml');
    }

    function downloadShp() {
        if (d3.event) d3.event.preventDefault();
        d3.select('.map').classed('loading', true);
        try {
            shpwrite.download(context.data.get('map'));
        } finally {
            d3.select('.map').classed('loading', false);
        }
    }

    function downloadWKT() {
        if (d3.event) d3.event.preventDefault();
        var contentArray = [];
        var features = context.data.get('map').features;
        if (features.length === 0) return;
        var content = features.map(wellknown.stringify).join('\n');
        var meta = context.data.get('meta');
        saveAs(new Blob([content], {
            type: 'text/plain;charset=utf-8'
        }), 'map.wkt');
    }

    function allProperties(properties, key, value) {
        properties[key] = value;
        return true;
    }

    function opengebiedje(gebiedsnummer){
        for (i = 0; i < gebiedjes.length; i++) { 
            if(gebiedsnummer == gebiedjes[i].Name || gebiedsnummer == gebiedjes[i].FileName)
            {
                var gebiedje = gebiedjes[i];
                var lat = (gebiedje.MaxLatitude + gebiedje.MinLatitude) / 2;
                var long = (gebiedje.MaxLongitude + gebiedje.MinLongitude) / 2;
            } 
        }
        return [lat, long];
    }

    var gebiedjes = [
        {
            "FileName": "314.kml",
            "Name": "314",
            "Decription": "BEL_SCHRIJF GEBIED",
            "MaxLatitude": 52.260279897645063,
            "MaxLongitude": 6.2122193723917007,
            "MinLatitude": 52.2599856194033,
            "MinLongitude": 6.2114328145980835
        },
        {
            "FileName": "319.kml",
            "Name": "319",
            "Decription": "BEL_SCHRIJF GEBIED",
            "MaxLatitude": 52.251612031147346,
            "MaxLongitude": 6.2173497676849365,
            "MinLatitude": 52.251263918353445,
            "MinLongitude": 6.2164351344108582
        },
        {
            "FileName": "321.kml",
            "Name": "321",
            "Decription": "BEL_SCHRIJF GEBIED",
            "MaxLatitude": 52.252234358061386,
            "MaxLongitude": 6.2161105871200562,
            "MinLatitude": 52.2519363318819,
            "MinLongitude": 6.2158021330833435
        },
        {
            "FileName": "322.kml",
            "Name": "322",
            "Decription": "BEL_SCHRIJF GEBIED",
            "MaxLatitude": 52.251772950289173,
            "MaxLongitude": 6.2163332104682922,
            "MinLatitude": 52.251511866896948,
            "MinLongitude": 6.2159308791160583
        },
        {
            "FileName": "BE1.kml",
            "Name": "BE1",
            "Decription": "BEL_SCHRIJF GEBIED",
            "MaxLatitude": 52.27379694285699,
            "MaxLongitude": 6.1448764801025391,
            "MinLatitude": 52.273061673009593,
            "MinLongitude": 6.1432564258575439
        },
        {
            "FileName": "BE16.kml",
            "Name": "BE16",
            "Decription": "BEL_SCHRIJF GEBIED",
            "MaxLatitude": 52.268485657059259,
            "MaxLongitude": 6.1641991138458252,
            "MinLatitude": 52.267655095627951,
            "MinLongitude": 6.1630403995513916
        },
        {
            "FileName": "BE17.kml",
            "Name": "BE17",
            "Decription": "BEL_SCHRIJF GEBIED",
            "MaxLatitude": 52.268485657059259,
            "MaxLongitude": 6.1641991138458252,
            "MinLatitude": 52.267655095627951,
            "MinLongitude": 6.1630403995513916
        },
        {
            "FileName": "BE2.kml",
            "Name": "BE2",
            "Decription": "BEL_SCHRIJF GEBIED",
            "MaxLatitude": 52.27379694285699,
            "MaxLongitude": 6.1448764801025391,
            "MinLatitude": 52.273061673009593,
            "MinLongitude": 6.1432564258575439
        },
        {
            "FileName": "BE3.kml",
            "Name": "BE3",
            "Decription": "BEL_SCHRIJF GEBIED",
            "MaxLatitude": 52.27379694285699,
            "MaxLongitude": 6.1448764801025391,
            "MinLatitude": 52.273061673009593,
            "MinLongitude": 6.1432564258575439
        },
        {
            "FileName": "BE302.kml",
            "Name": "BE302",
            "Decription": "BEL_SCHRIJF GEBIED",
            "MaxLatitude": 52.254884486266384,
            "MaxLongitude": 6.21564120054245,
            "MinLatitude": 52.253966646898377,
            "MinLongitude": 6.2140265107154846
        },
        {
            "FileName": "BE320.kml",
            "Name": "BE320",
            "Decription": "BEL_SCHRIJF GEBIED",
            "MaxLatitude": 52.253124319638843,
            "MaxLongitude": 6.21639221906662,
            "MinLatitude": 52.252835330383114,
            "MinLongitude": 6.2159442901611328
        },
        {
            "FileName": "BE4.kml",
            "Name": "BE4",
            "Decription": "BEL_SCHRIJF GEBIED",
            "MaxLatitude": 52.27379694285699,
            "MaxLongitude": 6.1448764801025391,
            "MinLatitude": 52.273061673009593,
            "MinLongitude": 6.1432564258575439
        },
        {
            "FileName": "BE5.kml",
            "Name": "BE5",
            "Decription": "BEL_SCHRIJF GEBIED",
            "MaxLatitude": 52.270471719129326,
            "MaxLongitude": 6.1559218168258667,
            "MinLatitude": 52.269844724020523,
            "MinLongitude": 6.1555516719818115
        },
        {
            "FileName": "BE6.kml",
            "Name": "BE8",
            "Decription": "BEL_SCHRIJF GEBIED",
            "MaxLatitude": 52.268838558886017,
            "MaxLongitude": 6.1657708883285522,
            "MinLatitude": 52.268378965256289,
            "MinLongitude": 6.1647838354110718
        },
        {
            "FileName": "BE7.kml",
            "Name": "BE8",
            "Decription": "BEL_SCHRIJF GEBIED",
            "MaxLatitude": 52.268838558886017,
            "MaxLongitude": 6.1657708883285522,
            "MinLatitude": 52.268378965256289,
            "MinLongitude": 6.1647838354110718
        },
        {
            "FileName": "BE8.kml",
            "Name": "BE8",
            "Decription": "BEL_SCHRIJF GEBIED",
            "MaxLatitude": 52.268838558886017,
            "MaxLongitude": 6.1657708883285522,
            "MinLatitude": 52.268378965256289,
            "MinLongitude": 6.1647838354110718
        },
        {
            "FileName": "BE9.kml",
            "Name": "BE9",
            "Decription": "BEL_SCHRIJF GEBIED",
            "MaxLatitude": 52.268838558886017,
            "MaxLongitude": 6.1657708883285522,
            "MinLatitude": 52.268378965256289,
            "MinLongitude": 6.1647838354110718
        },
        {
            "FileName": "BS10.kml",
            "Name": "BS10",
            "Decription": "BEL_SCHRIJF GEBIED",
            "MaxLatitude": 52.269317844310429,
            "MaxLongitude": 6.1641106009483337,
            "MinLatitude": 52.26890749751955,
            "MinLongitude": 6.1632710695266724
        },
        {
            "FileName": "BS11.kml",
            "Name": "BS10",
            "Decription": "BEL_SCHRIJF GEBIED",
            "MaxLatitude": 52.269317844310429,
            "MaxLongitude": 6.1641106009483337,
            "MinLatitude": 52.26890749751955,
            "MinLongitude": 6.1632710695266724
        },
        {
            "FileName": "BS12.kml",
            "Name": "BS10",
            "Decription": "BEL_SCHRIJF GEBIED",
            "MaxLatitude": 52.269317844310429,
            "MaxLongitude": 6.1641106009483337,
            "MinLatitude": 52.26890749751955,
            "MinLongitude": 6.1632710695266724
        },
        {
            "FileName": "BS13.kml",
            "Name": "BS10",
            "Decription": "BEL_SCHRIJF GEBIED",
            "MaxLatitude": 52.269317844310429,
            "MaxLongitude": 6.1641106009483337,
            "MinLatitude": 52.26890749751955,
            "MinLongitude": 6.1632710695266724
        },
        {
            "FileName": "BS318.kml",
            "Name": "BS BLANKENBURG",
            "Decription": "BEL_SCHRIJF GEBIED",
            "MaxLatitude": 52.252143226301662,
            "MaxLongitude": 6.215364933013916,
            "MinLatitude": 52.251878861038492,
            "MinLongitude": 6.2150806188583374
        },
        {
            "FileName": "112.kml",
            "Name": "112",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.344630851840037,
            "MaxLongitude": 6.234666109085083,
            "MinLatitude": 52.330044998004219,
            "MinLongitude": 6.2044912576675415
        },
        {
            "FileName": "113.kml",
            "Name": "113",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.332087307150907,
            "MaxLongitude": 6.2173980474472046,
            "MinLatitude": 52.329438515653244,
            "MinLongitude": 6.2122797220945358
        },
        {
            "FileName": "114.kml",
            "Name": "114",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.332461010015095,
            "MaxLongitude": 6.2164914608001709,
            "MinLatitude": 52.330185962981318,
            "MinLongitude": 6.213042140007019
        },
        {
            "FileName": "115.kml",
            "Name": "115",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.332726533815737,
            "MaxLongitude": 6.2154614925384521,
            "MinLatitude": 52.33017612823005,
            "MinLongitude": 6.2107890844345093
        },
        {
            "FileName": "116.kml",
            "Name": "116",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.335755359185086,
            "MaxLongitude": 6.2323755025863647,
            "MinLatitude": 52.321173135557643,
            "MinLongitude": 6.2062320113182068
        },
        {
            "FileName": "117.kml",
            "Name": "117",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.339226452657066,
            "MaxLongitude": 6.2698191404342651,
            "MinLatitude": 52.31527724832624,
            "MinLongitude": 6.2297147512435913
        },
        {
            "FileName": "118.kml",
            "Name": "116",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.335480019995195,
            "MaxLongitude": 6.2809664011001587,
            "MinLatitude": 52.331818501384006,
            "MinLongitude": 6.2752962112426758
        },
        {
            "FileName": "119.kml",
            "Name": "119",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.332723255753855,
            "MaxLongitude": 6.2790821492671967,
            "MinLatitude": 52.329940093543669,
            "MinLongitude": 6.2748134136199951
        },
        {
            "FileName": "119A.kml",
            "Name": "119A",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.332528210633832,
            "MaxLongitude": 6.2824630737304688,
            "MinLatitude": 52.330884224732458,
            "MinLongitude": 6.2790781259536743
        },
        {
            "FileName": "120A.kml",
            "Name": "120A",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.332660972531684,
            "MaxLongitude": 6.2878274917602539,
            "MinLatitude": 52.327055123386351,
            "MinLongitude": 6.2814357876777649
        },
        {
            "FileName": "121.kml",
            "Name": "121",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.338023564426727,
            "MaxLongitude": 6.2840723991394043,
            "MinLatitude": 52.314926355968531,
            "MinLongitude": 6.2621158361434937
        },
        {
            "FileName": "124.kml",
            "Name": "124",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.275656399004276,
            "MaxLongitude": 6.2815806269645691,
            "MinLatitude": 52.261497622413074,
            "MinLongitude": 6.2307125329971313
        },
        {
            "FileName": "125.kml",
            "Name": "125",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.295327717909842,
            "MaxLongitude": 6.3397067785263062,
            "MinLatitude": 52.280472897483129,
            "MinLongitude": 6.3001763820648193
        },
        {
            "FileName": "126.kml",
            "Name": "126",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.284132101747531,
            "MaxLongitude": 6.3276529312133789,
            "MinLatitude": 52.259814879667694,
            "MinLongitude": 6.2728071212768555
        },
        {
            "FileName": "127.kml",
            "Name": "127",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.27975743030234,
            "MaxLongitude": 6.27592921257019,
            "MinLatitude": 52.276445782659643,
            "MinLongitude": 6.2717074155807495
        },
        {
            "FileName": "127a.kml",
            "Name": "127a",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.276732976967175,
            "MaxLongitude": 6.27605527639389,
            "MinLatitude": 52.273311140932,
            "MinLongitude": 6.2691137194633484
        },
        {
            "FileName": "129.kml",
            "Name": "129",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.316841472937185,
            "MaxLongitude": 6.3035988807678223,
            "MinLatitude": 52.303696331614283,
            "MinLongitude": 6.2702375650405884
        },
        {
            "FileName": "130.kml",
            "Name": "130",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.314867327074232,
            "MaxLongitude": 6.3303324580192566,
            "MinLatitude": 52.291467649936251,
            "MinLongitude": 6.2929022312164307
        },
        {
            "FileName": "130a.kml",
            "Name": "130a",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.299874718732852,
            "MaxLongitude": 6.3234901428222656,
            "MinLatitude": 52.296539969035635,
            "MinLongitude": 6.316688060760498
        },
        {
            "FileName": "131.kml",
            "Name": "131",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.307868908493916,
            "MaxLongitude": 6.3512722123414278,
            "MinLatitude": 52.286736024061426,
            "MinLongitude": 6.3144658505916595
        },
        {
            "FileName": "131A.kml",
            "Name": "131A",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.305848098956524,
            "MaxLongitude": 6.3646620512008667,
            "MinLatitude": 52.282816135726556,
            "MinLongitude": 6.33760392665863
        },
        {
            "FileName": "132.kml",
            "Name": "132",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.285454591814094,
            "MaxLongitude": 6.352495551109314,
            "MinLatitude": 52.266666937056272,
            "MinLongitude": 6.3155722618103027
        },
        {
            "FileName": "133.kml",
            "Name": "133",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.292999905875718,
            "MaxLongitude": 6.3770592212677,
            "MinLatitude": 52.274418958494572,
            "MinLongitude": 6.3496202230453491
        },
        {
            "FileName": "134.kml",
            "Name": "134",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.2970156742147,
            "MaxLongitude": 6.4095085859298706,
            "MinLatitude": 52.278145945858384,
            "MinLongitude": 6.37357234954834
        },
        {
            "FileName": "135.kml",
            "Name": "135",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.307699650404309,
            "MaxLongitude": 6.3868385553359985,
            "MinLatitude": 52.282944124162512,
            "MinLongitude": 6.3533324003219604
        },
        {
            "FileName": "136.kml",
            "Name": "136",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.317402219241238,
            "MaxLongitude": 6.3729554414749146,
            "MinLatitude": 52.301469011070076,
            "MinLongitude": 6.3287526369094849
        },
        {
            "FileName": "137.kml",
            "Name": "137",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.323158475840515,
            "MaxLongitude": 6.3496819138526917,
            "MinLatitude": 52.308498302810271,
            "MinLongitude": 6.3105538487434387
        },
        {
            "FileName": "138.kml",
            "Name": "138",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.330769487642833,
            "MaxLongitude": 6.3318157196044922,
            "MinLatitude": 52.314385254824117,
            "MinLongitude": 6.2806069850921631
        },
        {
            "FileName": "139.kml",
            "Name": "139",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.267254582183469,
            "MaxLongitude": 6.2609142065048218,
            "MinLatitude": 52.249792619015885,
            "MinLongitude": 6.2308408343960764
        },
        {
            "FileName": "143.kml",
            "Name": "143",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.269339182239669,
            "MaxLongitude": 6.3288277387619019,
            "MinLatitude": 52.252771292736391,
            "MinLongitude": 6.2953484058380127
        },
        {
            "FileName": "143A.kml",
            "Name": "143A",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.263403559268511,
            "MaxLongitude": 6.3032394647598267,
            "MinLatitude": 52.252534845239992,
            "MinLongitude": 6.2858051061630249
        },
        {
            "FileName": "145.kml",
            "Name": "145",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.2742761746742,
            "MaxLongitude": 6.3567173480987549,
            "MinLatitude": 52.25982144659276,
            "MinLongitude": 6.3272291421890259
        },
        {
            "FileName": "174.kml",
            "Name": "174",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.281505053407216,
            "MaxLongitude": 6.3513690233230591,
            "MinLatitude": 52.279022259331718,
            "MinLongitude": 6.3454225659370422
        },
        {
            "FileName": "Bu1.kml",
            "Name": "Bu1",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.2886704079147,
            "MaxLongitude": 6.1450803279876709,
            "MinLatitude": 52.266801538024488,
            "MinLongitude": 6.1114132404327393
        },
        {
            "FileName": "BU10.kml",
            "Name": "BU10",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.287430869712161,
            "MaxLongitude": 6.231745183467865,
            "MinLatitude": 52.266338640298024,
            "MinLongitude": 6.1976248025894165
        },
        {
            "FileName": "BU11.kml",
            "Name": "BU11",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.3093231791839,
            "MaxLongitude": 6.2440592050552368,
            "MinLatitude": 52.282592975518078,
            "MinLongitude": 6.1961844563484192
        },
        {
            "FileName": "BU12.kml",
            "Name": "BU12",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.288591656022867,
            "MaxLongitude": 6.2482890486717224,
            "MinLatitude": 52.2669180824352,
            "MinLongitude": 6.2133452296257019
        },
        {
            "FileName": "BU128.kml",
            "Name": "BU128",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.30669762464639,
            "MaxLongitude": 6.3069087266922,
            "MinLatitude": 52.27681421159086,
            "MinLongitude": 6.2660104036331177
        },
        {
            "FileName": "BU13.kml",
            "Name": "BU13",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.287718813181229,
            "MaxLongitude": 6.2726354598999023,
            "MinLatitude": 52.271733889194628,
            "MinLongitude": 6.2410229444503784
        },
        {
            "FileName": "BU14.kml",
            "Name": "BU14",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.300301181154268,
            "MaxLongitude": 6.2724852561950684,
            "MinLatitude": 52.285831970077737,
            "MinLongitude": 6.2467950582504272
        },
        {
            "FileName": "BU140.kml",
            "Name": "BU140",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.2661777739991,
            "MaxLongitude": 6.2880367040634155,
            "MinLatitude": 52.249923987012075,
            "MinLongitude": 6.2494289875030518
        },
        {
            "FileName": "Bu15.kml",
            "Name": "Bu15",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.304677104393896,
            "MaxLongitude": 6.2668794393539429,
            "MinLatitude": 52.2873496545492,
            "MinLongitude": 6.23186320066452
        },
        {
            "FileName": "Bu16.kml",
            "Name": "Bu16",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.315198543740344,
            "MaxLongitude": 6.2794482707977295,
            "MinLatitude": 52.300980232072057,
            "MinLongitude": 6.25372588634491
        },
        {
            "FileName": "Bu17.kml",
            "Name": "Bu17",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.319779573482656,
            "MaxLongitude": 6.2621426582336426,
            "MinLatitude": 52.29653176717737,
            "MinLongitude": 6.2150269746780396
        },
        {
            "FileName": "Bu18.kml",
            "Name": "Bu18",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.3255207671664,
            "MaxLongitude": 6.2415808439254761,
            "MinLatitude": 52.306100662350822,
            "MinLongitude": 6.2019034707918763
        },
        {
            "FileName": "Bu19.kml",
            "Name": "Bu19",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.339383776218547,
            "MaxLongitude": 6.2074041366577148,
            "MinLatitude": 52.322142045205759,
            "MinLongitude": 6.1727017164230347
        },
        {
            "FileName": "Bu2.kml",
            "Name": "Bu2",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.302341582982187,
            "MaxLongitude": 6.1439967155456543,
            "MinLatitude": 52.281660941321952,
            "MinLongitude": 6.1045655608177185
        },
        {
            "FileName": "Bu20.kml",
            "Name": "Bu20",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.341192956946571,
            "MaxLongitude": 6.1796110868453979,
            "MinLatitude": 52.316713582434225,
            "MinLongitude": 6.1411803960800171
        },
        {
            "FileName": "Bu21.kml",
            "Name": "Bu21",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.338606985692913,
            "MaxLongitude": 6.1499592661857605,
            "MinLatitude": 52.323351922897167,
            "MinLongitude": 6.1183467507362366
        },
        {
            "FileName": "Bu22.kml",
            "Name": "Bu22",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.33291666098998,
            "MaxLongitude": 6.1470222473144531,
            "MinLatitude": 52.310289068561993,
            "MinLongitude": 6.1141464114189148
        },
        {
            "FileName": "Bu23.kml",
            "Name": "Bu23",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.332018466805245,
            "MaxLongitude": 6.1254304647445679,
            "MinLatitude": 52.310287428699759,
            "MinLongitude": 6.0931849479675293
        },
        {
            "FileName": "Bu24.kml",
            "Name": "Bu24",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.376285259415091,
            "MaxLongitude": 6.115538477897644,
            "MinLatitude": 52.352331552793515,
            "MinLongitude": 6.0782504081726074
        },
        {
            "FileName": "Bu25.kml",
            "Name": "Bu25",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.364861166043383,
            "MaxLongitude": 6.1381092667579651,
            "MinLatitude": 52.335725858639584,
            "MinLongitude": 6.1076071858406067
        },
        {
            "FileName": "Bu26.kml",
            "Name": "Bu26",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.352877104759685,
            "MaxLongitude": 6.15596204996109,
            "MinLatitude": 52.335324321480272,
            "MinLongitude": 6.1336755752563477
        },
        {
            "FileName": "Bu27.kml",
            "Name": "Bu27",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.349392337151912,
            "MaxLongitude": 6.1806464195251465,
            "MinLatitude": 52.340119584195136,
            "MinLongitude": 6.1520728468894958
        },
        {
            "FileName": "Bu28.kml",
            "Name": "Bu28",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.371705168559679,
            "MaxLongitude": 6.1783209443092346,
            "MinLatitude": 52.348324078807721,
            "MinLongitude": 6.1377927660942078
        },
        {
            "FileName": "Bu29.kml",
            "Name": "Bu29",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.357364137079934,
            "MaxLongitude": 6.1845946311950684,
            "MinLatitude": 52.3439590249494,
            "MinLongitude": 6.1643010377883911
        },
        {
            "FileName": "BU3.kml",
            "Name": "BU3",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.313266958162593,
            "MaxLongitude": 6.1478771176189184,
            "MinLatitude": 52.29676798008667,
            "MinLongitude": 6.1010947823524475
        },
        {
            "FileName": "Bu30.kml",
            "Name": "Bu30",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.365429492812993,
            "MaxLongitude": 6.2124627828598022,
            "MinLatitude": 52.341330608971688,
            "MinLongitude": 6.1807912588119507
        },
        {
            "FileName": "Bu31.kml",
            "Name": "Bu31",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.344765215993107,
            "MaxLongitude": 6.2147212028503418,
            "MinLatitude": 52.329704057597809,
            "MinLongitude": 6.1794394254684448
        },
        {
            "FileName": "Bu32 1_2.kml",
            "Name": "Bu32 1/2",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.362982523803652,
            "MaxLongitude": 6.2047648429870605,
            "MinLatitude": 52.358143874254317,
            "MinLongitude": 6.1978983879089355
        },
        {
            "FileName": "Bu32 2_2.kml",
            "Name": "Bu32 2/2",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.362982523803652,
            "MaxLongitude": 6.2200899349409156,
            "MinLatitude": 52.342328240482495,
            "MinLongitude": 6.1978983879089355
        },
        {
            "FileName": "Bu4.kml",
            "Name": "Bu4",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.325048646854462,
            "MaxLongitude": 6.1667311191558838,
            "MinLatitude": 52.293772575865823,
            "MinLongitude": 6.1432564258575439
        },
        {
            "FileName": "BU5.kml",
            "Name": "BU5",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.281454184600591,
            "MaxLongitude": 6.1797720193862915,
            "MinLatitude": 52.271742095644441,
            "MinLongitude": 6.1559969186782837
        },
        {
            "FileName": "BU6.kml",
            "Name": "BU6",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.299648363933045,
            "MaxLongitude": 6.197211742401123,
            "MinLatitude": 52.279511280665815,
            "MinLongitude": 6.1570322513580322
        },
        {
            "FileName": "BU7.kml",
            "Name": "BU7",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.324016839474105,
            "MaxLongitude": 6.2061543948948383,
            "MinLatitude": 52.297835220427949,
            "MinLongitude": 6.1613269132794812
        },
        {
            "FileName": "BU8.kml",
            "Name": "BU8",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.296886086068845,
            "MaxLongitude": 6.2177789211273193,
            "MinLatitude": 52.271862678991162,
            "MinLongitude": 6.1767127923667431
        },
        {
            "FileName": "Bu9.kml",
            "Name": "Bu9",
            "Decription": "BUITENGEBIED + KERNEN",
            "MaxLatitude": 52.266785123294163,
            "MaxLongitude": 6.2122642993927,
            "MinLatitude": 52.253060282409329,
            "MinLongitude": 6.18730902671814
        },
        {
            "FileName": "DO 101.kml",
            "Name": "107",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.267963685486244,
            "MaxLongitude": 6.2292641401290894,
            "MinLatitude": 52.264874407157805,
            "MinLongitude": 6.2262949347496033
        },
        {
            "FileName": "DO 103.kml",
            "Name": "DevV111",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.267678075797789,
            "MaxLongitude": 6.2341618537902832,
            "MinLatitude": 52.265998850593228,
            "MinLongitude": 6.2314823269844055
        },
        {
            "FileName": "DO 104.kml",
            "Name": "DevV110",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.26745483935796,
            "MaxLongitude": 6.2357711791992188,
            "MinLatitude": 52.265908567866646,
            "MinLongitude": 6.2339311838150024
        },
        {
            "FileName": "DO 105.kml",
            "Name": "DevV106",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.266077642640759,
            "MaxLongitude": 6.2296906113624573,
            "MinLatitude": 52.263961699256591,
            "MinLongitude": 6.227099597454071
        },
        {
            "FileName": "DO 106.kml",
            "Name": "108",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.267274279650543,
            "MaxLongitude": 6.2324050068855286,
            "MinLatitude": 52.264418055555637,
            "MinLongitude": 6.2285801768302917
        },
        {
            "FileName": "DO 107.kml",
            "Name": "DevV105",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.266350130725634,
            "MaxLongitude": 6.2338453531265259,
            "MinLatitude": 52.263431466434767,
            "MinLongitude": 6.2302941083908081
        },
        {
            "FileName": "DO 108.kml",
            "Name": "DevV109",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.265782171740554,
            "MaxLongitude": 6.2349209189414978,
            "MinLatitude": 52.2632229830623,
            "MinLongitude": 6.2328153848648071
        },
        {
            "FileName": "DO 109.kml",
            "Name": "DevV104",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.264358959321207,
            "MaxLongitude": 6.23112827539444,
            "MinLatitude": 52.262781389060038,
            "MinLongitude": 6.2280169129371643
        },
        {
            "FileName": "DO 110.kml",
            "Name": "DevV102",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.263314912859144,
            "MaxLongitude": 6.233343780040741,
            "MinLatitude": 52.26148448905839,
            "MinLongitude": 6.2288162112236023
        },
        {
            "FileName": "DO 111.kml",
            "Name": "103",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.263242682320531,
            "MaxLongitude": 6.235964298248291,
            "MinLatitude": 52.260504401489854,
            "MinLongitude": 6.2294787168502808
        },
        {
            "FileName": "DO 112.kml",
            "Name": "devV32",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.260821249589114,
            "MaxLongitude": 6.2342557311058044,
            "MinLatitude": 52.2573472887449,
            "MinLongitude": 6.2295511364936829
        },
        {
            "FileName": "DO 113.kml",
            "Name": "devV33",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.258253565635187,
            "MaxLongitude": 6.2363934516906738,
            "MinLatitude": 52.255134056477537,
            "MinLongitude": 6.2302029132843018
        },
        {
            "FileName": "DO 201.kml",
            "Name": "36",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.264866199436668,
            "MaxLongitude": 6.22851362451911,
            "MinLatitude": 52.261676563983045,
            "MinLongitude": 6.2239158153533936
        },
        {
            "FileName": "DO 202.kml",
            "Name": "35",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.262487537826168,
            "MaxLongitude": 6.2295109033584595,
            "MinLatitude": 52.259621154940881,
            "MinLongitude": 6.2258845567703247
        },
        {
            "FileName": "DO 203.kml",
            "Name": "43",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.259928158988757,
            "MaxLongitude": 6.230483204126358,
            "MinLatitude": 52.2560165714551,
            "MinLongitude": 6.2258684635162354
        },
        {
            "FileName": "DO 204.kml",
            "Name": "45",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.257142060428173,
            "MaxLongitude": 6.2312020361423492,
            "MinLatitude": 52.25343301062783,
            "MinLongitude": 6.223929226398468
        },
        {
            "FileName": "DO 205.kml",
            "Name": "40",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.2558088741613,
            "MaxLongitude": 6.2270593643188477,
            "MinLatitude": 52.253451893251572,
            "MinLongitude": 6.22257336974144
        },
        {
            "FileName": "DO 206.kml",
            "Name": "41",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.255327800804814,
            "MaxLongitude": 6.22413843870163,
            "MinLatitude": 52.252909219860605,
            "MinLongitude": 6.22076153755188
        },
        {
            "FileName": "DO 207.kml",
            "Name": "DevV64def",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.254983000991174,
            "MaxLongitude": 6.2229140102863312,
            "MinLatitude": 52.250430160685291,
            "MinLongitude": 6.21565332139653
        },
        {
            "FileName": "DO 301.kml",
            "Name": "DevV98",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.263618066414267,
            "MaxLongitude": 6.213243305683136,
            "MinLatitude": 52.260611112242444,
            "MinLongitude": 6.20778959697418
        },
        {
            "FileName": "DO 302.kml",
            "Name": "DevV100",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.266088115439587,
            "MaxLongitude": 6.21554246843516,
            "MinLatitude": 52.262688670209151,
            "MinLongitude": 6.2104678630566923
        },
        {
            "FileName": "DO 303.kml",
            "Name": "DevV101",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.267091733071624,
            "MaxLongitude": 6.2178911178125418,
            "MinLatitude": 52.264189598954452,
            "MinLongitude": 6.2128970592493715
        },
        {
            "FileName": "DO 304.kml",
            "Name": "112",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.26794891261644,
            "MaxLongitude": 6.2276870012283325,
            "MinLatitude": 52.26322134145704,
            "MinLongitude": 6.2170788645744324
        },
        {
            "FileName": "DO 305.kml",
            "Name": "DevV99def2",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.264918236383082,
            "MaxLongitude": 6.21891979866632,
            "MinLatitude": 52.260818048290446,
            "MinLongitude": 6.2126006214566587
        },
        {
            "FileName": "DO 401.kml",
            "Name": "96",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.2605774573405,
            "MaxLongitude": 6.2171915173530579,
            "MinLatitude": 52.258256849213446,
            "MinLongitude": 6.2104712426662445
        },
        {
            "FileName": "DO 402.kml",
            "Name": "97",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.262116527341689,
            "MaxLongitude": 6.2175267934799194,
            "MinLatitude": 52.2595850366779,
            "MinLongitude": 6.2130850553512573
        },
        {
            "FileName": "DO 403.kml",
            "Name": "92",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.26399863474326,
            "MaxLongitude": 6.2199364439584315,
            "MinLatitude": 52.2609693352829,
            "MinLongitude": 6.2147580832242966
        },
        {
            "FileName": "DO 404.kml",
            "Name": "94",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.264035570199134,
            "MaxLongitude": 6.2236985564231873,
            "MinLatitude": 52.260929601269424,
            "MinLongitude": 6.2188330292701721
        },
        {
            "FileName": "DO 405.kml",
            "Name": "93",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.2615605701177,
            "MaxLongitude": 6.21964305639267,
            "MinLatitude": 52.259276388503423,
            "MinLongitude": 6.2166540697216988
        },
        {
            "FileName": "DO 406.kml",
            "Name": "95",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.259637572323435,
            "MaxLongitude": 6.2195223569869995,
            "MinLatitude": 52.257698637418592,
            "MinLongitude": 6.2164726853370667
        },
        {
            "FileName": "DO 407.kml",
            "Name": "devV39",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.260550369230131,
            "MaxLongitude": 6.2222099304199219,
            "MinLatitude": 52.257696995608839,
            "MinLongitude": 6.2192058563232422
        },
        {
            "FileName": "DO 408.kml",
            "Name": "38",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.263035839672639,
            "MaxLongitude": 6.2256002426147461,
            "MinLatitude": 52.259844430822824,
            "MinLongitude": 6.220284104347229
        },
        {
            "FileName": "DO 409.kml",
            "Name": "39A",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.261530455782776,
            "MaxLongitude": 6.2264344096183777,
            "MinLatitude": 52.258429236730187,
            "MinLongitude": 6.2208232283592224
        },
        {
            "FileName": "DO 410.kml",
            "Name": "37",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.25953906793697,
            "MaxLongitude": 6.2264585494995117,
            "MinLatitude": 52.257352214212844,
            "MinLongitude": 6.222955584526062
        },
        {
            "FileName": "DO 411.kml",
            "Name": "44",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.258399684632067,
            "MaxLongitude": 6.2255533039569855,
            "MinLatitude": 52.255895893699204,
            "MinLongitude": 6.2192246317863464
        },
        {
            "FileName": "DO 412.kml",
            "Name": "42",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.257664159400854,
            "MaxLongitude": 6.2236744165420532,
            "MinLatitude": 52.255135698382183,
            "MinLongitude": 6.2185755372047424
        },
        {
            "FileName": "DO 501.kml",
            "Name": "53",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.260125165814394,
            "MaxLongitude": 6.20964914560318,
            "MinLatitude": 52.257245495618513,
            "MinLongitude": 6.2058967351913452
        },
        {
            "FileName": "DO 502.kml",
            "Name": "52",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.259604737552252,
            "MaxLongitude": 6.2121731042861938,
            "MinLatitude": 52.256790707345317,
            "MinLongitude": 6.2084770202636719
        },
        {
            "FileName": "DO 503.kml",
            "Name": "51",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.258480131964141,
            "MaxLongitude": 6.2074322998523712,
            "MinLatitude": 52.25447154299755,
            "MinLongitude": 6.2026043236255646
        },
        {
            "FileName": "DO 504.kml",
            "Name": "54",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.257437588903436,
            "MaxLongitude": 6.2105771899223328,
            "MinLatitude": 52.255593787401104,
            "MinLongitude": 6.2066155672073364
        },
        {
            "FileName": "DO 505.kml",
            "Name": "55",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.256899068873317,
            "MaxLongitude": 6.212194561958313,
            "MinLatitude": 52.253845142588922,
            "MinLongitude": 6.2070715427398682
        },
        {
            "FileName": "DO 506.kml",
            "Name": "56",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.254772835980475,
            "MaxLongitude": 6.2075275182724,
            "MinLatitude": 52.253671095295545,
            "MinLongitude": 6.2057921290397644
        },
        {
            "FileName": "DO 507.kml",
            "Name": "DevV47",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.2551422660001,
            "MaxLongitude": 6.2041720747947693,
            "MinLatitude": 52.253350912170227,
            "MinLongitude": 6.201508641242981
        },
        {
            "FileName": "DO 508.kml",
            "Name": "DevV46def",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.25459879232718,
            "MaxLongitude": 6.2061874865503341,
            "MinLatitude": 52.252449272548262,
            "MinLongitude": 6.2028685212135315
        },
        {
            "FileName": "DO 509.kml",
            "Name": "57",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.253805735714373,
            "MaxLongitude": 6.2089061737060547,
            "MinLatitude": 52.252191665728787,
            "MinLongitude": 6.20576798915863
        },
        {
            "FileName": "DO 510.kml",
            "Name": "devV60",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.253621836503612,
            "MaxLongitude": 6.2111082673072815,
            "MinLatitude": 52.251370651340075,
            "MinLongitude": 6.2079915404319763
        },
        {
            "FileName": "DO 511.kml",
            "Name": "DevV48",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.253828723062114,
            "MaxLongitude": 6.2037348747253418,
            "MinLatitude": 52.251710553140214,
            "MinLongitude": 6.1996150016784668
        },
        {
            "FileName": "DO 512.kml",
            "Name": "devV49",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.252437967082336,
            "MaxLongitude": 6.2038448452949524,
            "MinLatitude": 52.250570968717668,
            "MinLongitude": 6.199260950088501
        },
        {
            "FileName": "DO 513.kml",
            "Name": "DevV50def",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.252608735218,
            "MaxLongitude": 6.2058135867118835,
            "MinLatitude": 52.250547979681684,
            "MinLongitude": 6.20303213596344
        },
        {
            "FileName": "DO 514.kml",
            "Name": "devV58",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.252444535099727,
            "MaxLongitude": 6.2081900238990784,
            "MinLatitude": 52.250354214476495,
            "MinLongitude": 6.2054219841957092
        },
        {
            "FileName": "DO 515.kml",
            "Name": "59",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.251804148830765,
            "MaxLongitude": 6.2111994624137878,
            "MinLatitude": 52.250379666733927,
            "MinLongitude": 6.2078708410263062
        },
        {
            "FileName": "DO 516.kml",
            "Name": "62",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.25225898823458,
            "MaxLongitude": 6.2149786949157715,
            "MinLatitude": 52.250452739262855,
            "MinLongitude": 6.2117815017700195
        },
        {
            "FileName": "DO 517.kml",
            "Name": "62a",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.253452714235046,
            "MaxLongitude": 6.2156385183334351,
            "MinLatitude": 52.251217940987772,
            "MinLongitude": 6.2136563658714294
        },
        {
            "FileName": "DO 518.kml",
            "Name": "devV61",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.253524960719915,
            "MaxLongitude": 6.2142840027809143,
            "MinLatitude": 52.251666218270508,
            "MinLongitude": 6.2121771275997162
        },
        {
            "FileName": "DO 519.kml",
            "Name": "D61A",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.253538506922737,
            "MaxLongitude": 6.2123876810073853,
            "MinLatitude": 52.252291828444221,
            "MinLongitude": 6.2111637555062771
        },
        {
            "FileName": "DO 520.kml",
            "Name": "63",
            "Decription": "DEVENTER OOST",
            "MaxLatitude": 52.255789171600689,
            "MaxLongitude": 6.216464638710022,
            "MinLatitude": 52.253429726692424,
            "MinLongitude": 6.2109366059303284
        },
        {
            "FileName": "DW 101.kml",
            "Name": "D7P",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.276271824059776,
            "MaxLongitude": 6.13760232925415,
            "MinLatitude": 52.272418301888074,
            "MinLongitude": 6.1330962181091309
        },
        {
            "FileName": "DW 102.kml",
            "Name": "D2P",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.277216279757965,
            "MaxLongitude": 6.1375755071640015,
            "MinLatitude": 52.274365619764907,
            "MinLongitude": 6.1338767409324646
        },
        {
            "FileName": "DW 103.kml",
            "Name": "D1P",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.275113176721689,
            "MaxLongitude": 6.1392867565155029,
            "MinLatitude": 52.2738363319689,
            "MinLongitude": 6.136888861656189
        },
        {
            "FileName": "DW 104.kml",
            "Name": "D3P",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.277082530956221,
            "MaxLongitude": 6.1392545700073242,
            "MinLatitude": 52.274738989524614,
            "MinLongitude": 6.1365616321563721
        },
        {
            "FileName": "DW 105.kml",
            "Name": "D4P",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.2773533103203,
            "MaxLongitude": 6.1406144499778748,
            "MinLatitude": 52.274753760131752,
            "MinLongitude": 6.1381816864013672
        },
        {
            "FileName": "DW 106.kml",
            "Name": "D6P",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.278657951340506,
            "MaxLongitude": 6.1422425508499146,
            "MinLatitude": 52.276296440884231,
            "MinLongitude": 6.1368995904922485
        },
        {
            "FileName": "DW 107.kml",
            "Name": "D5P",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.276593482821681,
            "MaxLongitude": 6.1424517631530762,
            "MinLatitude": 52.274263045104405,
            "MinLongitude": 6.1394047737121582
        },
        {
            "FileName": "DW 108.kml",
            "Name": "DEVw49",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.274164573206974,
            "MaxLongitude": 6.142580509185791,
            "MinLatitude": 52.272736706110244,
            "MinLongitude": 6.1380904912948608
        },
        {
            "FileName": "DW 109.kml",
            "Name": "DEVw31",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.272459333488364,
            "MaxLongitude": 6.142781674861908,
            "MinLatitude": 52.269508243931362,
            "MinLongitude": 6.1402872204780579
        },
        {
            "FileName": "DW 110.kml",
            "Name": "DO 110",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.27193576741881,
            "MaxLongitude": 6.143004298210144,
            "MinLatitude": 52.268630100937251,
            "MinLongitude": 6.1401718854904175
        },
        {
            "FileName": "DW 111.kml",
            "Name": "DEVw29",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.268925552858214,
            "MaxLongitude": 6.1446297168731689,
            "MinLatitude": 52.267206979935104,
            "MinLongitude": 6.14223450422287
        },
        {
            "FileName": "DW 201.kml",
            "Name": "D8B",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.278344512789225,
            "MaxLongitude": 6.1461237072944641,
            "MinLatitude": 52.27483089544463,
            "MinLongitude": 6.14335298538208
        },
        {
            "FileName": "DW 202.kml",
            "Name": "D10",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.279491588635842,
            "MaxLongitude": 6.1493074893951416,
            "MinLatitude": 52.277724193309879,
            "MinLongitude": 6.1451393365859985
        },
        {
            "FileName": "DW 203.kml",
            "Name": "D9",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.278111483738464,
            "MaxLongitude": 6.14784300327301,
            "MinLatitude": 52.276045348633083,
            "MinLongitude": 6.1452412605285645
        },
        {
            "FileName": "DW 204.kml",
            "Name": "D11",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.27939969238021,
            "MaxLongitude": 6.1513888835906982,
            "MinLatitude": 52.27728447777303,
            "MinLongitude": 6.1471433658152819
        },
        {
            "FileName": "DW 205.kml",
            "Name": "D12",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.279081336021079,
            "MaxLongitude": 6.1562798917293549,
            "MinLatitude": 52.275232981604013,
            "MinLongitude": 6.1513245105743408
        },
        {
            "FileName": "DW 206.kml",
            "Name": "D13B",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.278506975979973,
            "MaxLongitude": 6.1539450287818909,
            "MinLatitude": 52.275557930202396,
            "MinLongitude": 6.1502489447593689
        },
        {
            "FileName": "DW 207.kml",
            "Name": "D14B",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.2783642053289,
            "MaxLongitude": 6.1515337228775024,
            "MinLatitude": 52.276170074373553,
            "MinLongitude": 6.1485832929611206
        },
        {
            "FileName": "DW 208.kml",
            "Name": "D16B",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.277361515729744,
            "MaxLongitude": 6.1492887139320374,
            "MinLatitude": 52.27561208807051,
            "MinLongitude": 6.1466628313064575
        },
        {
            "FileName": "DW 209.kml",
            "Name": "D17B",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.276618099467484,
            "MaxLongitude": 6.15135133266449,
            "MinLatitude": 52.274527276948064,
            "MinLongitude": 6.1480629444122314
        },
        {
            "FileName": "DW 210.kml",
            "Name": "24",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.277062837847019,
            "MaxLongitude": 6.1536043882369995,
            "MinLatitude": 52.274699601214849,
            "MinLongitude": 6.1500424146652222
        },
        {
            "FileName": "DW 211.kml",
            "Name": "D18B",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.2757860492598,
            "MaxLongitude": 6.1513996124267578,
            "MinLatitude": 52.273102704014335,
            "MinLongitude": 6.1459386348724365
        },
        {
            "FileName": "DW 212.kml",
            "Name": "D19B",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.275147641173085,
            "MaxLongitude": 6.1482641100883484,
            "MinLatitude": 52.273511370748778,
            "MinLongitude": 6.1452734470367432
        },
        {
            "FileName": "DW 213.kml",
            "Name": "D21B",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.274121901983492,
            "MaxLongitude": 6.1502355337142944,
            "MinLatitude": 52.272575863026141,
            "MinLongitude": 6.1472770571708679
        },
        {
            "FileName": "DW 214.kml",
            "Name": "D20B",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.274394340627332,
            "MaxLongitude": 6.1491438746452332,
            "MinLatitude": 52.27216390511844,
            "MinLongitude": 6.1448416113853455
        },
        {
            "FileName": "DW 215.kml",
            "Name": "D26B",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.274087436734511,
            "MaxLongitude": 6.1551761627197266,
            "MinLatitude": 52.266735879066658,
            "MinLongitude": 6.1424973607063293
        },
        {
            "FileName": "DW 216.kml",
            "Name": "D22",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.273381713839512,
            "MaxLongitude": 6.1533656716346741,
            "MinLatitude": 52.272232838580877,
            "MinLongitude": 6.1517000198364258
        },
        {
            "FileName": "DW 217.kml",
            "Name": "D23",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.275054094742707,
            "MaxLongitude": 6.1541569232940674,
            "MinLatitude": 52.272881136137407,
            "MinLongitude": 6.1513835191726685
        },
        {
            "FileName": "DW 218.kml",
            "Name": "D25",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.275681016170573,
            "MaxLongitude": 6.1556053161621094,
            "MinLatitude": 52.270829529117535,
            "MinLongitude": 6.1524885892868042
        },
        {
            "FileName": "DW 301.kml",
            "Name": "54",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.275142717681661,
            "MaxLongitude": 6.16083562374115,
            "MinLatitude": 52.272730141097838,
            "MinLongitude": 6.1555194854736328
        },
        {
            "FileName": "DW 302.kml",
            "Name": "D55K",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.274880130680529,
            "MaxLongitude": 6.1640891432762146,
            "MinLatitude": 52.274082513125336,
            "MinLongitude": 6.1608168482780457
        },
        {
            "FileName": "DW 303.kml",
            "Name": "D66",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.274505941516047,
            "MaxLongitude": 6.1662322282791138,
            "MinLatitude": 52.273240567912175,
            "MinLongitude": 6.1644190549850464
        },
        {
            "FileName": "DW 304.kml",
            "Name": "D56K",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.274098925153815,
            "MaxLongitude": 6.1630672216415405,
            "MinLatitude": 52.272948427239385,
            "MinLongitude": 6.160733699798584
        },
        {
            "FileName": "DW 305.kml",
            "Name": "62",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.274039841822848,
            "MaxLongitude": 6.1646497249603271,
            "MinLatitude": 52.272283717972492,
            "MinLongitude": 6.162305474281311
        },
        {
            "FileName": "DW 307.kml",
            "Name": "D53",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.273045260597051,
            "MaxLongitude": 6.162305474281311,
            "MinLatitude": 52.270599743218384,
            "MinLongitude": 6.1578905582427979
        },
        {
            "FileName": "DW 311.kml",
            "Name": "D57",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.272290283051,
            "MaxLongitude": 6.1639738082885742,
            "MinLatitude": 52.270547220559919,
            "MinLongitude": 6.162106990814209
        },
        {
            "FileName": "DW 312.kml",
            "Name": "D47K",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.269613291648014,
            "MaxLongitude": 6.1565065383911133,
            "MinLatitude": 52.267877510343034,
            "MinLongitude": 6.1542467772960663
        },
        {
            "FileName": "DW 313.kml",
            "Name": "D48",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.26937693393549,
            "MaxLongitude": 6.1586335301399231,
            "MinLatitude": 52.267513931466141,
            "MinLongitude": 6.1558011174201965
        },
        {
            "FileName": "DW 314.kml",
            "Name": "D46K",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.268180353677693,
            "MaxLongitude": 6.157812774181366,
            "MinLatitude": 52.266151510058123,
            "MinLongitude": 6.1540630459785461
        },
        {
            "FileName": "DW 315.kml",
            "Name": "D49",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.268851690062576,
            "MaxLongitude": 6.1608812212944031,
            "MinLatitude": 52.267318598919552,
            "MinLongitude": 6.1579281091690063
        },
        {
            "FileName": "DW 316.kml",
            "Name": "D50K",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.270432327027542,
            "MaxLongitude": 6.161457896232605,
            "MinLatitude": 52.26870560550438,
            "MinLongitude": 6.159384548664093
        },
        {
            "FileName": "DW 317.kml",
            "Name": "D51",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.26933754086086,
            "MaxLongitude": 6.1627721786499023,
            "MinLatitude": 52.268339571294923,
            "MinLongitude": 6.1605566740036011
        },
        {
            "FileName": "DW 318.kml",
            "Name": "D52K",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.270353542718965,
            "MaxLongitude": 6.1646872758865356,
            "MinLatitude": 52.269074919468927,
            "MinLongitude": 6.1614981293678284
        },
        {
            "FileName": "DW 319.kml",
            "Name": "D60K",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.27309613905615,
            "MaxLongitude": 6.1681372672319412,
            "MinLatitude": 52.2714647167989,
            "MinLongitude": 6.1655160784721375
        },
        {
            "FileName": "DW 401.kml",
            "Name": "D75K",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.272451127171351,
            "MaxLongitude": 6.1689198017120361,
            "MinLatitude": 52.270767158776962,
            "MinLongitude": 6.1669778823852539
        },
        {
            "FileName": "DW 402.kml",
            "Name": "D73K",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.272285359242211,
            "MaxLongitude": 6.1728948354721069,
            "MinLatitude": 52.270645700493517,
            "MinLongitude": 6.1685550212860107
        },
        {
            "FileName": "DW 403.kml",
            "Name": "D74K",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.271748660803183,
            "MaxLongitude": 6.1721706390380859,
            "MinLatitude": 52.270340411987249,
            "MinLongitude": 6.16882860660553
        },
        {
            "FileName": "DW 404.kml",
            "Name": "D72K",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.27079177865874,
            "MaxLongitude": 6.1738792061805725,
            "MinLatitude": 52.269142216348854,
            "MinLongitude": 6.1713847517967224
        },
        {
            "FileName": "DW 405.kml",
            "Name": "D67",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.272749836132164,
            "MaxLongitude": 6.173243522644043,
            "MinLatitude": 52.271431890785166,
            "MinLongitude": 6.170821487903595
        },
        {
            "FileName": "DW 406.kml",
            "Name": "D68",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.272170470214718,
            "MaxLongitude": 6.1755368113517761,
            "MinLatitude": 52.27024029003006,
            "MinLongitude": 6.17232084274292
        },
        {
            "FileName": "DW 407.kml",
            "Name": "D69K",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.271742095644441,
            "MaxLongitude": 6.1765801906585693,
            "MinLatitude": 52.268351061203923,
            "MinLongitude": 6.173492968082428
        },
        {
            "FileName": "DW 408.kml",
            "Name": "D71K",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.2695886711118,
            "MaxLongitude": 6.1749976873397827,
            "MinLatitude": 52.2677404504845,
            "MinLongitude": 6.1723852157592773
        },
        {
            "FileName": "DW 409.kml",
            "Name": "D77K",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.270061383018948,
            "MaxLongitude": 6.1724710464477539,
            "MinLatitude": 52.268500429750212,
            "MinLongitude": 6.1695554852485657
        },
        {
            "FileName": "DW 410.kml",
            "Name": "D79K",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.268820503511904,
            "MaxLongitude": 6.1735546588897705,
            "MinLatitude": 52.266988665520891,
            "MinLongitude": 6.1713767051696777
        },
        {
            "FileName": "DW 411.kml",
            "Name": "D78",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.269431099355891,
            "MaxLongitude": 6.1718890070915222,
            "MinLatitude": 52.267464688048122,
            "MinLongitude": 6.1697915196418762
        },
        {
            "FileName": "DW 412.kml",
            "Name": "D76K",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.271423684277927,
            "MaxLongitude": 6.1685335636138916,
            "MinLatitude": 52.269276809802264,
            "MinLongitude": 6.1647704243659973
        },
        {
            "FileName": "DW 413.kml",
            "Name": "D80K",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.2703207158824,
            "MaxLongitude": 6.1722403764724731,
            "MinLatitude": 52.265655775254174,
            "MinLongitude": 6.1658674478530884
        },
        {
            "FileName": "DW 414.kml",
            "Name": "D82K",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.269890682078376,
            "MaxLongitude": 6.1661839485168457,
            "MinLatitude": 52.266496223045372,
            "MinLongitude": 6.1584591865539551
        },
        {
            "FileName": "DW 415.kml",
            "Name": "D84",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.267431859072396,
            "MaxLongitude": 6.1594757437705994,
            "MinLatitude": 52.265744416983665,
            "MinLongitude": 6.1565709114074707
        },
        {
            "FileName": "DW 416.kml",
            "Name": "D85K",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.266666937056272,
            "MaxLongitude": 6.1592906713485718,
            "MinLatitude": 52.264551021795107,
            "MinLongitude": 6.15546315908432
        },
        {
            "FileName": "DW 417.kml",
            "Name": "D86",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.266524128265154,
            "MaxLongitude": 6.1607792973518372,
            "MinLatitude": 52.265144440336414,
            "MinLongitude": 6.157987117767334
        },
        {
            "FileName": "DW 418.kml",
            "Name": "D89K",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.267172509309596,
            "MaxLongitude": 6.1633113026618958,
            "MinLatitude": 52.265754266053762,
            "MinLongitude": 6.1603850126266479
        },
        {
            "FileName": "DW 419.kml",
            "Name": "D90K",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.267712546030239,
            "MaxLongitude": 6.165153980255127,
            "MinLatitude": 52.266202396429627,
            "MinLongitude": 6.1626487970352173
        },
        {
            "FileName": "DW 420.kml",
            "Name": "D91K",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.268600555636866,
            "MaxLongitude": 6.1673426628112793,
            "MinLatitude": 52.266706332503922,
            "MinLongitude": 6.1641132831573486
        },
        {
            "FileName": "DW 421.kml",
            "Name": "D87",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.26569353008653,
            "MaxLongitude": 6.161482036113739,
            "MinLatitude": 52.263910810313448,
            "MinLongitude": 6.158810555934906
        },
        {
            "FileName": "DW 422.kml",
            "Name": "D88K",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.266144944070433,
            "MaxLongitude": 6.1650305986404419,
            "MinLatitude": 52.263137619508839,
            "MinLongitude": 6.1606264114379883
        },
        {
            "FileName": "DW 423.kml",
            "Name": "D95",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.265741133959807,
            "MaxLongitude": 6.16620808839798,
            "MinLatitude": 52.263997813954994,
            "MinLongitude": 6.163630485534668
        },
        {
            "FileName": "DW 424.kml",
            "Name": "D93K",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.266639031926353,
            "MaxLongitude": 6.1659747362136841,
            "MinLatitude": 52.265578623974982,
            "MinLongitude": 6.1634185910224915
        },
        {
            "FileName": "DW 425.kml",
            "Name": "D92K",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.26748110252688,
            "MaxLongitude": 6.16832971572876,
            "MinLatitude": 52.265882303766212,
            "MinLongitude": 6.1652666330337524
        },
        {
            "FileName": "DW 427.kml",
            "Name": "D94",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.266460110381914,
            "MaxLongitude": 6.16893857717514,
            "MinLatitude": 52.264506699759572,
            "MinLongitude": 6.1658594012260437
        },
        {
            "FileName": "DW 501.kml",
            "Name": "D108Z",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.268400303637442,
            "MaxLongitude": 6.1763924360275269,
            "MinLatitude": 52.264263748555621,
            "MinLongitude": 6.1721330881118774
        },
        {
            "FileName": "DW 502.kml",
            "Name": "D106Z",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.266817952748781,
            "MaxLongitude": 6.1726748943328857,
            "MinLatitude": 52.265155110306658,
            "MinLongitude": 6.1696493625640869
        },
        {
            "FileName": "DW 503.kml",
            "Name": "D107Z",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.264805462252937,
            "MaxLongitude": 6.17555558681488,
            "MinLatitude": 52.262599168691835,
            "MinLongitude": 6.1720579862594604
        },
        {
            "FileName": "DW 504.kml",
            "Name": "D105Z",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.265491623435295,
            "MaxLongitude": 6.1717280745506287,
            "MinLatitude": 52.263093296060504,
            "MinLongitude": 6.1680212616920471
        },
        {
            "FileName": "DW 505.kml",
            "Name": "D104Z",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.263759784719028,
            "MaxLongitude": 6.1733025312423706,
            "MinLatitude": 52.261998328659253,
            "MinLongitude": 6.1705479025840759
        },
        {
            "FileName": "DW 506.kml",
            "Name": "D102Z",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.264923653452826,
            "MaxLongitude": 6.1704915761947632,
            "MinLatitude": 52.262615584971982,
            "MinLongitude": 6.1664468050003052
        },
        {
            "FileName": "DW 507.kml",
            "Name": "101",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.26433269430283,
            "MaxLongitude": 6.1675089597702026,
            "MinLatitude": 52.262093544289222,
            "MinLongitude": 6.1632764339447021
        },
        {
            "FileName": "DW 508.kml",
            "Name": "D103Z",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.263520112611083,
            "MaxLongitude": 6.17256224155426,
            "MinLatitude": 52.260158000200242,
            "MinLongitude": 6.16582453250885
        },
        {
            "FileName": "DW 601.kml",
            "Name": "429",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.262374265042823,
            "MaxLongitude": 6.1781948804855347,
            "MinLatitude": 52.258227297000445,
            "MinLongitude": 6.169634610414505
        },
        {
            "FileName": "DW 602.kml",
            "Name": "428",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.25953906793697,
            "MaxLongitude": 6.18042916059494,
            "MinLatitude": 52.256129860478119,
            "MinLongitude": 6.1713767051696777
        },
        {
            "FileName": "DW 603.kml",
            "Name": "Dev110",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.260553652638322,
            "MaxLongitude": 6.1850237846374512,
            "MinLatitude": 52.258112371540435,
            "MinLongitude": 6.17817610502243
        },
        {
            "FileName": "DW 604.kml",
            "Name": "Dev111",
            "Decription": "DEVENTER WEST",
            "MaxLatitude": 52.26029590435536,
            "MaxLongitude": 6.1882880330085754,
            "MinLatitude": 52.257514754347746,
            "MinLongitude": 6.1829923465847969
        },
        {
            "FileName": "D10.kml",
            "Name": "D10",
            "Decription": "DIEPENVEEN",
            "MaxLatitude": 52.289060883976987,
            "MaxLongitude": 6.1590251326560974,
            "MinLatitude": 52.281592022522034,
            "MinLongitude": 6.1521881818771362
        },
        {
            "FileName": "D11.kml",
            "Name": "D11",
            "Decription": "DIEPENVEEN",
            "MaxLatitude": 52.291561161720992,
            "MaxLongitude": 6.1543795466423035,
            "MinLatitude": 52.286201141355775,
            "MinLongitude": 6.1454102396965027
        },
        {
            "FileName": "D12.kml",
            "Name": "D12",
            "Decription": "DIEPENVEEN",
            "MaxLatitude": 52.291515226132105,
            "MaxLongitude": 6.1598405241966248,
            "MinLatitude": 52.288557202026233,
            "MinLongitude": 6.154065728187561
        },
        {
            "FileName": "D13.kml",
            "Name": "D13",
            "Decription": "DIEPENVEEN",
            "MaxLatitude": 52.291574286166224,
            "MaxLongitude": 6.1588266491889954,
            "MinLatitude": 52.28938737182407,
            "MinLongitude": 6.1548864841461182
        },
        {
            "FileName": "D15.kml",
            "Name": "D15",
            "Decription": "DIEPENVEEN",
            "MaxLatitude": 52.294194175675571,
            "MaxLongitude": 6.1525771021842957,
            "MinLatitude": 52.291485696085537,
            "MinLongitude": 6.1481702327728271
        },
        {
            "FileName": "D16.kml",
            "Name": "D16",
            "Decription": "DIEPENVEEN",
            "MaxLatitude": 52.2966006627394,
            "MaxLongitude": 6.1483204364776611,
            "MinLatitude": 52.291533682401322,
            "MinLongitude": 6.1435863375663757
        },
        {
            "FileName": "D2.kml",
            "Name": "D2",
            "Decription": "DIEPENVEEN",
            "MaxLatitude": 52.2945140639042,
            "MaxLongitude": 6.146387904882431,
            "MinLatitude": 52.288729471741689,
            "MinLongitude": 6.1394262313842773
        },
        {
            "FileName": "D3.kml",
            "Name": "D3",
            "Decription": "DIEPENVEEN",
            "MaxLatitude": 52.289485809898814,
            "MaxLongitude": 6.1466145515441895,
            "MinLatitude": 52.285790130472151,
            "MinLongitude": 6.1440825462341309
        },
        {
            "FileName": "D5.kml",
            "Name": "D5",
            "Decription": "DIEPENVEEN",
            "MaxLatitude": 52.287146205810551,
            "MaxLongitude": 6.1511635780334473,
            "MinLatitude": 52.27922574537461,
            "MinLongitude": 6.1446189880371094
        },
        {
            "FileName": "D6.kml",
            "Name": "D6",
            "Decription": "DIEPENVEEN",
            "MaxLatitude": 52.2845242586263,
            "MaxLongitude": 6.1568927764892578,
            "MinLatitude": 52.279445640531854,
            "MinLongitude": 6.1493799090385437
        },
        {
            "FileName": "D8.kml",
            "Name": "D8",
            "Decription": "DIEPENVEEN",
            "MaxLatitude": 52.286192937583031,
            "MaxLongitude": 6.1555972695350647,
            "MinLatitude": 52.2839893492187,
            "MinLongitude": 6.1501255631446838
        },
        {
            "FileName": "Di1.kml",
            "Name": "Di1",
            "Decription": "DIEPENVEEN",
            "MaxLatitude": 52.303945627089107,
            "MaxLongitude": 6.1477464437484741,
            "MinLatitude": 52.294571479495573,
            "MinLongitude": 6.1342388391494751
        },
        {
            "FileName": "Di14.kml",
            "Name": "Di14",
            "Decription": "DIEPENVEEN",
            "MaxLatitude": 52.295050486671435,
            "MaxLongitude": 6.1603957414627075,
            "MinLatitude": 52.288855802440622,
            "MinLongitude": 6.151045560836792
        },
        {
            "FileName": "Di4.kml",
            "Name": "Di4",
            "Decription": "DIEPENVEEN",
            "MaxLatitude": 52.2870428403677,
            "MaxLongitude": 6.1471724510192871,
            "MinLatitude": 52.283733378015263,
            "MinLongitude": 6.1446270346641541
        },
        {
            "FileName": "Di7.kml",
            "Name": "Di7",
            "Decription": "DIEPENVEEN",
            "MaxLatitude": 52.286855797524737,
            "MaxLongitude": 6.152794361114502,
            "MinLatitude": 52.284273212990676,
            "MinLongitude": 6.148374080657959
        },
        {
            "FileName": "Di9.kml",
            "Name": "Di9",
            "Decription": "DIEPENVEEN",
            "MaxLatitude": 52.286801653396488,
            "MaxLongitude": 6.1569195985794067,
            "MinLatitude": 52.284901644813942,
            "MinLongitude": 6.153092086315155
        },
        {
            "FileName": "011.kml",
            "Name": "011",
            "Decription": "OLST",
            "MaxLatitude": 52.338538155494568,
            "MaxLongitude": 6.1143502593040466,
            "MinLatitude": 52.335186650757819,
            "MinLongitude": 6.1077815294265747
        },
        {
            "FileName": "012.kml",
            "Name": "012",
            "Decription": "OLST",
            "MaxLatitude": 52.338711869598683,
            "MaxLongitude": 6.1191004514694214,
            "MinLatitude": 52.335280070223348,
            "MinLongitude": 6.1145567893981934
        },
        {
            "FileName": "013.kml",
            "Name": "013",
            "Decription": "OLST",
            "MaxLatitude": 52.337091057712364,
            "MaxLongitude": 6.1215788125991821,
            "MinLatitude": 52.331028465222936,
            "MinLongitude": 6.1132478713989258
        },
        {
            "FileName": "015.kml",
            "Name": "015",
            "Decription": "OLST",
            "MaxLatitude": 52.336383060572622,
            "MaxLongitude": 6.1106193065643311,
            "MinLatitude": 52.333593572656596,
            "MinLongitude": 6.1074033379554749
        },
        {
            "FileName": "016.kml",
            "Name": "016",
            "Decription": "OLST",
            "MaxLatitude": 52.337115640742759,
            "MaxLongitude": 6.107824444770813,
            "MinLatitude": 52.335065369052053,
            "MinLongitude": 6.1030849814414978
        },
        {
            "FileName": "018.kml",
            "Name": "018",
            "Decription": "OLST",
            "MaxLatitude": 52.33483427731376,
            "MaxLongitude": 6.1062312126159668,
            "MinLatitude": 52.3315183466727,
            "MinLongitude": 6.1018458008766174
        },
        {
            "FileName": "02.kml",
            "Name": "02",
            "Decription": "OLST",
            "MaxLatitude": 52.344829120751882,
            "MaxLongitude": 6.1148679256439209,
            "MinLatitude": 52.342469499167954,
            "MinLongitude": 6.1107346415519714
        },
        {
            "FileName": "021.kml",
            "Name": "021",
            "Decription": "OLST",
            "MaxLatitude": 52.330697367034141,
            "MaxLongitude": 6.1078405380249023,
            "MinLatitude": 52.327609183388155,
            "MinLongitude": 6.105077862739563
        },
        {
            "FileName": "03.kml",
            "Name": "03",
            "Decription": "OLST",
            "MaxLatitude": 52.343100382550013,
            "MaxLongitude": 6.1149939894676208,
            "MinLatitude": 52.340775082102489,
            "MinLongitude": 6.1114856600761414
        },
        {
            "FileName": "05.kml",
            "Name": "05",
            "Decription": "OLST",
            "MaxLatitude": 52.343942638800122,
            "MaxLongitude": 6.11077219247818,
            "MinLatitude": 52.33806289643946,
            "MinLongitude": 6.10491156578064
        },
        {
            "FileName": "06.kml",
            "Name": "06",
            "Decription": "OLST",
            "MaxLatitude": 52.341348634800383,
            "MaxLongitude": 6.1096510291099548,
            "MinLatitude": 52.336451894125283,
            "MinLongitude": 6.1042571067810059
        },
        {
            "FileName": "07.kml",
            "Name": "07",
            "Decription": "OLST",
            "MaxLatitude": 52.341632130957883,
            "MaxLongitude": 6.1124968528747559,
            "MinLatitude": 52.339611566633366,
            "MinLongitude": 6.1094123125076294
        },
        {
            "FileName": "08.kml",
            "Name": "08",
            "Decription": "OLST",
            "MaxLatitude": 52.3448446872817,
            "MaxLongitude": 6.1181750893592834,
            "MinLatitude": 52.339175650137463,
            "MinLongitude": 6.1136770248413086
        },
        {
            "FileName": "09.kml",
            "Name": "09",
            "Decription": "OLST",
            "MaxLatitude": 52.339996677255726,
            "MaxLongitude": 6.1130520701408386,
            "MinLatitude": 52.337443413175748,
            "MinLongitude": 6.1094740033149719
        },
        {
            "FileName": "Bo 1.kml",
            "Name": "Bo 1",
            "Decription": "OLST",
            "MaxLatitude": 52.333598899402268,
            "MaxLongitude": 6.1284667253494263,
            "MinLatitude": 52.330739983771664,
            "MinLongitude": 6.1245346069335938
        },
        {
            "FileName": "Bo 2.kml",
            "Name": "Bo 2",
            "Decription": "OLST",
            "MaxLatitude": 52.333662820299864,
            "MaxLongitude": 6.1343139410018921,
            "MinLatitude": 52.330754735709704,
            "MinLongitude": 6.12711489200592
        },
        {
            "FileName": "Bo 3.kml",
            "Name": "Bo 3",
            "Decription": "OLST",
            "MaxLatitude": 52.333352639183069,
            "MaxLongitude": 6.1362987756729126,
            "MinLatitude": 52.328056688323912,
            "MinLongitude": 6.1271336674690247
        },
        {
            "FileName": "Bo 4.kml",
            "Name": "Bo 4",
            "Decription": "OLST",
            "MaxLatitude": 52.331138284371868,
            "MaxLongitude": 6.1309128999710083,
            "MinLatitude": 52.328654993711659,
            "MinLongitude": 6.126725971698761
        },
        {
            "FileName": "DN 1.kml",
            "Name": "DN 1",
            "Decription": "OLST",
            "MaxLatitude": 52.360387999002256,
            "MaxLongitude": 6.1163780093193054,
            "MinLatitude": 52.352449510545959,
            "MinLongitude": 6.1069688200950623
        },
        {
            "FileName": "DN 2.kml",
            "Name": "DN 2",
            "Decription": "OLST",
            "MaxLatitude": 52.360030912323957,
            "MaxLongitude": 6.1149859428405762,
            "MinLatitude": 52.357133161872255,
            "MinLongitude": 6.1091709136962891
        },
        {
            "FileName": "O1.kml",
            "Name": "O1",
            "Decription": "OLST",
            "MaxLatitude": 52.344935628477934,
            "MaxLongitude": 6.1168742179870605,
            "MinLatitude": 52.342307270557583,
            "MinLongitude": 6.1134946346282959
        },
        {
            "FileName": "O10.kml",
            "Name": "O10",
            "Decription": "OLST",
            "MaxLatitude": 52.340911096700935,
            "MaxLongitude": 6.1159944534301758,
            "MinLatitude": 52.337210694998411,
            "MinLongitude": 6.1124539375305176
        },
        {
            "FileName": "O14.kml",
            "Name": "O14",
            "Decription": "OLST",
            "MaxLatitude": 52.335884833568734,
            "MaxLongitude": 6.1133712530136108,
            "MinLatitude": 52.3324020045096,
            "MinLongitude": 6.1086344718933105
        },
        {
            "FileName": "O16.kml",
            "Name": "O16",
            "Decription": "OLST",
            "MaxLatitude": 52.337102529794905,
            "MaxLongitude": 6.107824444770813,
            "MinLatitude": 52.334719550470261,
            "MinLongitude": 6.1029642820358276
        },
        {
            "FileName": "O17.kml",
            "Name": "O17",
            "Decription": "OLST",
            "MaxLatitude": 52.335248930423454,
            "MaxLongitude": 6.1077225208282471,
            "MinLatitude": 52.3334198384471,
            "MinLongitude": 6.1049303412437439
        },
        {
            "FileName": "O19.kml",
            "Name": "O19",
            "Decription": "OLST",
            "MaxLatitude": 52.333695190462819,
            "MaxLongitude": 6.108972430229187,
            "MinLatitude": 52.330900615720978,
            "MinLongitude": 6.1056143045425415
        },
        {
            "FileName": "O20.kml",
            "Name": "O20",
            "Decription": "OLST",
            "MaxLatitude": 52.332179094111815,
            "MaxLongitude": 6.10739529132843,
            "MinLatitude": 52.327478045553029,
            "MinLongitude": 6.100383996963501
        },
        {
            "FileName": "O4.kml",
            "Name": "O4",
            "Decription": "OLST",
            "MaxLatitude": 52.3430889120234,
            "MaxLongitude": 6.1120757460594177,
            "MinLatitude": 52.341148711561772,
            "MinLongitude": 6.1081275343894958
        },
        {
            "FileName": "S1.kml",
            "Name": "S1",
            "Decription": "SCHALKHAAR",
            "MaxLatitude": 52.271259553814261,
            "MaxLongitude": 6.1891061067581177,
            "MinLatitude": 52.266676785921462,
            "MinLongitude": 6.17655873298645
        },
        {
            "FileName": "S10.kml",
            "Name": "S10",
            "Decription": "SCHALKHAAR",
            "MaxLatitude": 52.267901311113619,
            "MaxLongitude": 6.2027102708816528,
            "MinLatitude": 52.265847832110786,
            "MinLongitude": 6.1983489990234375
        },
        {
            "FileName": "S11.kml",
            "Name": "S11",
            "Decription": "SCHALKHAAR",
            "MaxLatitude": 52.269184892366148,
            "MaxLongitude": 6.2053388357162476,
            "MinLatitude": 52.265984077068737,
            "MinLongitude": 6.1981773376464844
        },
        {
            "FileName": "S12.kml",
            "Name": "S12",
            "Decription": "SCHALKHAAR",
            "MaxLatitude": 52.272833539930467,
            "MaxLongitude": 6.2049338221549988,
            "MinLatitude": 52.268864821235248,
            "MinLongitude": 6.1972063779830933
        },
        {
            "FileName": "S13.kml",
            "Name": "S13",
            "Decription": "SCHALKHAAR",
            "MaxLatitude": 52.278442975400175,
            "MaxLongitude": 6.2068703770637512,
            "MinLatitude": 52.275004859700061,
            "MinLongitude": 6.2010808289051056
        },
        {
            "FileName": "S2.kml",
            "Name": "S2",
            "Decription": "SCHALKHAAR",
            "MaxLatitude": 52.2711774883545,
            "MaxLongitude": 6.1918714642524719,
            "MinLatitude": 52.267848785258082,
            "MinLongitude": 6.1882102489471436
        },
        {
            "FileName": "S3.kml",
            "Name": "S3",
            "Decription": "SCHALKHAAR",
            "MaxLatitude": 52.2720670698354,
            "MaxLongitude": 6.1971044540405273,
            "MinLatitude": 52.270113906253044,
            "MinLongitude": 6.1885374784469604
        },
        {
            "FileName": "S4.kml",
            "Name": "S4",
            "Decription": "SCHALKHAAR",
            "MaxLatitude": 52.270767158776962,
            "MaxLongitude": 6.1968415975570679,
            "MinLatitude": 52.268006362637976,
            "MinLongitude": 6.1898115277290344
        },
        {
            "FileName": "S5.kml",
            "Name": "S5",
            "Decription": "SCHALKHAAR",
            "MaxLatitude": 52.268700681297361,
            "MaxLongitude": 6.19429349899292,
            "MinLatitude": 52.266271339162337,
            "MinLongitude": 6.1849755048751831
        },
        {
            "FileName": "S6.kml",
            "Name": "S6",
            "Decription": "SCHALKHAAR",
            "MaxLatitude": 52.267014928965956,
            "MaxLongitude": 6.1895620822906494,
            "MinLatitude": 52.259739359959596,
            "MinLongitude": 6.1736404895782471
        },
        {
            "FileName": "S7.kml",
            "Name": "S7",
            "Decription": "SCHALKHAAR",
            "MaxLatitude": 52.266799896551746,
            "MaxLongitude": 6.1957418918609619,
            "MinLatitude": 52.259773836364033,
            "MinLongitude": 6.1880412697792053
        },
        {
            "FileName": "S8.kml",
            "Name": "S9",
            "Decription": "SCHALKHAAR",
            "MaxLatitude": 52.271240000000006,
            "MaxLongitude": 6.198725,
            "MinLatitude": 52.262931000000009,
            "MinLongitude": 6.193768
        },
        {
            "FileName": "S9.kml",
            "Name": "S9",
            "Decription": "SCHALKHAAR",
            "MaxLatitude": 52.266057944642,
            "MaxLongitude": 6.2036705017089844,
            "MinLatitude": 52.261172647695439,
            "MinLongitude": 6.1936283111572266
        }
        ]
return bar;
};
