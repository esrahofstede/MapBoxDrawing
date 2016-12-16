module.exports = function(context) {
    return function(e) {
        var sel = d3.select(e.popup._contentNode);

        sel.selectAll('.cancel')
            .on('click', clickClose);

        sel.selectAll('.save')
            .on('click', saveFeature);

        sel.selectAll('.add')
            .on('click', addRow);

        sel.selectAll('.delete-invert')
            .on('click', removeFeature);

        function clickClose() {
            context.map.closePopup(e.popup);
        }

        function removeFeature() {
            if (e.popup._source && context.mapLayer.hasLayer(e.popup._source)) {
                context.mapLayer.removeLayer(e.popup._source);
                 var name = context.data.get("map").name;
                var regio = context.data.get('map').regio;
                var zone = context.data.get('map').zone;
                var nummer = context.data.get('map').nummer;
                var gemeente = context.data.get('map').gemeente;

                context.data.set({map: context.mapLayer.toGeoJSON()}, 'popup');

                context.data.get("map").name = name;
                context.data.get('map').regio = regio;
                context.data.get('map').zone = zone;
                context.data.get('map').nummer = nummer;
                context.data.get('map').gemeente = gemeente;
            }
        }

        function losslessNumber(x) {
            var fl = parseFloat(x);
            if (fl.toString() === x) return fl;
            else return x;
        }

        function saveFeature() {
            var obj = {};
            var table = sel.select('table.marker-properties');
            table.selectAll('tr').each(collectRow);
            function collectRow() {
                if (d3.select(this).selectAll('input')[0][0].value) {
                    obj[d3.select(this).selectAll('input')[0][0].value] =
                        losslessNumber(d3.select(this).selectAll('input')[0][1].value);
                }
            }
            var name = context.data.get("map").name;
            var regio = context.data.get('map').regio;
            var zone = context.data.get('map').zone;
            var nummer = context.data.get('map').nummer;
            var gemeente = context.data.get('map').gemeente;
            e.popup._source.feature.properties = obj;

            context.data.set({map: context.mapLayer.toGeoJSON()}, 'popup');
            
            context.data.get("map").name = name;
            context.data.get('map').regio = regio;
            context.data.get('map').zone = zone;
            context.data.get('map').nummer = nummer;
            context.data.get('map').gemeente = gemeente;
            context.map.closePopup(e.popup);
        }

        function addRow() {
            var tr = sel.select('table.marker-properties tbody')
                .append('tr');

            tr.append('th')
                .append('input')
                .attr('type', 'text');

            tr.append('td')
                .append('input')
                .attr('type', 'text');
        }
    };
};
