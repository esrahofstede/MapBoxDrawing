using Newtonsoft.Json;
using SharpKml.Dom;
using SharpKml.Engine;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Xml;

namespace KmlToJsonExporter
{
    class Program
    {
        static void Main(string[] args)
        {
            var baseDir = Directory.GetCurrentDirectory();
            string basePath = Path.GetFullPath(Path.Combine(baseDir, @"..\.."));
            string gebiedPath = Path.GetFullPath(Path.Combine(basePath, @"Fase_1"));
            var gebiedsgrenzen = new List<GebiedsGrens>();
            
            foreach (var dir in Directory.GetDirectories(gebiedPath))
            {
                var omschrijving = new DirectoryInfo(dir).Name;
                foreach (var file in Directory.EnumerateFiles(dir))
                {
                    var fileName = Path.GetFileName(file);
                    string kml = File.ReadAllText(file);
                    var gebiedsgrens = GebiedjeInlezen(kml, omschrijving, fileName);
                    gebiedsgrenzen.Add(gebiedsgrens);
                }
            }

            var json = JsonConvert.SerializeObject(gebiedsgrenzen);
            var fileToWrite = basePath + @"\gebiedsgrenzen.json";
            File.WriteAllText(fileToWrite, json);
            Console.WriteLine("Downloaden geslaagd. Druk op een toets om af te sluiten...");
            Console.ReadKey();
        }

        private static GebiedsGrens GebiedjeInlezen(string kml, string description, string fileName)
        {
            KmlFile file;
            using (var stream = new MemoryStream(Encoding.UTF8.GetBytes(kml)))
            {
                file = KmlFile.Load(stream);
            }

            var gebiedsName = file.Root.Flatten().OfType<Placemark>().First().Name;
            var poly = file.Root.Flatten().OfType<Polygon>().First().OuterBoundary.LinearRing.Coordinates;

            return new GebiedsGrens
            {
                Name = gebiedsName,
                FileName = fileName,
                Decription = description,
                MaxLatitude = poly.Max(p => p.Latitude),
                MaxLongitude = poly.Max(p => p.Longitude),
                MinLatitude = poly.Min(p => p.Latitude),
                MinLongitude= poly.Min(p => p.Longitude),
            };

           
            
        }
    }
}
