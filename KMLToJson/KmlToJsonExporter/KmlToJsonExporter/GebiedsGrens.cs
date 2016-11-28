using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KmlToJsonExporter
{
    public class GebiedsGrens
    {
        public string FileName { get; set; }
        public string Name { get; set; }
        public string Decription { get; set; }
        public double MaxLatitude { get; set; }
        public double MaxLongitude { get; set; }
        public double MinLatitude { get; set; }
        public double MinLongitude { get; set; }
    }

    public struct Coordinaten
    {
        public double Latitude { get; set; }
        //
        // Summary:
        //     Gets or sets the Longitude.
        public double Longitude { get; set; }

    }
}
