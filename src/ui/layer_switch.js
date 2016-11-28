module.exports = function(context) {

    return function(selection) {
        var layers;

        if (!(/a\.tiles\.mapbox.com/).test(L.mapbox.config.HTTP_URL)) {
            layers = [{
                title: 'Mapbox',
                layer: L.mapbox.tileLayer('mapbox.osm-bright')
            }, {
                title: 'Mapbox Outdoors',
                layer: L.mapbox.tileLayer('mapbox.mapbox-outdoors')
            }, {
                title: 'Satellite',
                layer: L.mapbox.tileLayer('mapbox.satellite-full')
            }];

        } else {
            layers = [{
                title: 'Mapbox',
                layer: L.mapbox.tileLayer('mapbox.streets')
            }, {
                title: 'Satellite',
                layer: L.mapbox.tileLayer('mapbox.satellite')
            }, {
                title: 'EnricoKlees',
                layer: L.tileLayer('https://api.mapbox.com/styles/v1/enricoklees/cit7ka61y00102xo04a5cfy5d/tiles/256/{z}/{x}/{y}@2x?access_token=pk.eyJ1IjoiZW5yaWNva2xlZXMiLCJhIjoiY2ltcndnMmZpMDA0cHc4bHlzd3dwNGd6bSJ9.e_BHPxZ7s-2qKLNEF11oDQ', 
                {
                    maxZoom: 20
                })
            }, {
                title: 'OSM',
                layer: L.tileLayer('https://a.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
                })
            }];
        }

        var layerSwap = function(d) {
            var clicked = this instanceof d3.selection ? this.node() : this;
            layerButtons.classed('active', function() {
                return clicked === this;
            });
            layers.forEach(swap);
            function swap(l) {
                var datum = d instanceof d3.selection ? d.datum() : d;
                if (l.layer == datum.layer) context.map.addLayer(datum.layer);
                else if (context.map.hasLayer(l.layer)) context.map.removeLayer(l.layer);
            }
        };

        var layerButtons = selection.append('div')
            .attr('class', 'layer-switch')
            .selectAll('button')
            .data(layers)
            .enter()
            .append('button')
            .attr('class', 'pad0x')
            .on('click', layerSwap)
            .text(function(d) { return d.title; });

        layerButtons.filter(function(d, i) { return i === 0; }).call(layerSwap);

    };
};
