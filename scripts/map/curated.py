"""
Hand-curated map facts, read off the 300 dpi reference-map scan (see docs/SOURCES.md)
and the Reference Manual (Ref). Everything here was checked by eye against the scan.

Pixel coordinates refer to page 1 of Third-Reich_Map_DOS_EN.pdf extracted at full
resolution (4458 x 3458 px) with `pdfimages -j`.
"""

# Axial lattice fitted to 1,792 detected hex centres (median residual 1 px). Cubic in
# (i, j) where i = q - GRID_Q0 and j = r - GRID_R0. Regenerate with `extract.py --refit`.
GRID_Q0, GRID_R0 = 34, 17
GRID_FIT_X = [2346.664605866611, 84.7978444068065, 42.51390073793992, 0.004396659880354732,
              0.004759296135989199, 0.0027570461324607997, 6.336072102500048e-05,
              6.257055344424443e-05, -0.0006184083749990896, -0.0005221597145223911]
GRID_FIT_Y = [1530.831661647273, 0.10864548608837304, 73.56967312567117, -0.003787895549253103,
              -0.007904474669116864, -0.004335454639771963, -1.1307076794628111e-05,
              9.933902558676341e-05, -0.0002007220875834434, 0.0004016737615422565]

# Off-map areas printed on the sheet (scan pixels): US / Murmansk / Lend-Lease boxes and
# the two legend panels.
OFF_MAP = [
    [(0, 0), (660, 0), (660, 500), (300, 500), (300, 780), (0, 780)],
    [(40, 2600), (570, 2600), (570, 2500), (1115, 2500), (1115, 3458), (40, 3458)],
    [(3905, 2290), (4458, 2290), (4458, 3458), (3580, 3458), (3580, 2650), (3905, 2650)],
]

# Cities: (name, kind, x, y) with x, y the symbol position in scan pixels.
# kind: city (black dot), port (open circle), capital (star), objective (red name),
# combinations as printed. Objectives match the 42 listed in Ref 2.1. Names of minor
# cities are read from small print and may be misspelled.
CITIES = [
    ("Scapa Flow", "port", 1225, 367), ("Belfast", "port", 968, 619), ("Rosyth", "port", 1154, 614),
    ("Glasgow", "city", 1082, 628), ("Dublin", "capital", 904, 759), ("Bergen", "port", 1623, 409),
    ("Manchester", "objective", 1118, 836), ("Sheffield", "city", 1116, 869), ("Liverpool", "city", 1082, 821),
    ("Birmingham", "objective", 1104, 917), ("Coventry", "city", 1129, 928), ("London", "capital-objective", 1119, 1032),
    ("Harwich", "port", 1215, 982), ("Great Yarmouth", "port", 1285, 992), ("Plymouth", "port", 928, 1022),
    ("Southampton", "port", 1060, 1057), ("Portsmouth", "port", 1110, 1066), ("The Hague", "capital", 1396, 1023),
    ("Wilhelmshaven", "port", 1520, 1009), ("Bremen", "port", 1640, 1011), ("Calais", "port", 1250, 1102),
    ("Antwerp", "objective-port", 1335, 1078), ("Brussels", "capital", 1350, 1143), ("Essen", "objective", 1542, 1128),
    ("Cologne", "city", 1545, 1163), ("Bonn", "objective", 1515, 1239), ("Cherbourg", "port", 1032, 1145),
    ("Dieppe", "city", 1204, 1158), ("Brest", "port", 835, 1209), ("Lorient", "port", 887, 1238),
    ("Rennes", "city", 954, 1255), ("Caen", "city", 1074, 1224), ("St. Nazaire", "port", 959, 1328),
    ("Paris", "capital-objective", 1205, 1293), ("Sedan", "city", 1345, 1300), ("Frankfurt", "city", 1571, 1288),
    ("Metz", "city", 1402, 1369), ("Strasbourg", "city", 1417, 1451), ("Stuttgart", "city", 1582, 1407),
    ("La Rochelle", "port", 972, 1449), ("Bordeaux", "city", 967, 1526), ("Vichy", "city", 1162, 1508),
    ("Oslo", "objective", 1798, 456), ("Stockholm", "capital-port-objective", 2110, 552), ("Helsinki", "capital", 2350, 488),
    ("Leningrad", "objective-port", 2600, 495), ("Tallinn", "city", 2365, 572), ("Parnu", "port", 2332, 645),
    ("Riga", "objective", 2367, 802), ("Copenhagen", "capital", 1785, 865), ("Kiel", "port", 1659, 911),
    ("Hamburg", "port", 1681, 970), ("Rostock", "port", 1852, 968), ("Stettin", "port", 1859, 989),
    ("Kolberg", "city", 1968, 1005), ("Danzig", "port", 2098, 949), ("Konigsberg", "port", 2211, 958),
    ("Vilna", "city", 2427, 953), ("Minsk", "city", 2587, 1021), ("Berlin", "capital-objective", 1813, 1072),
    ("Poznan", "city", 2025, 1151), ("Warsaw", "capital-objective", 2239, 1151), ("Dresden", "city", 1875, 1218),
    ("Leipzig", "objective", 1727, 1235), ("Lodz", "city", 2127, 1232), ("Brest-Litovsk", "city", 2314, 1226),
    ("Breslau", "objective", 2030, 1317), ("Krakow", "objective", 2167, 1358), ("Lvov", "objective", 2367, 1378),
    ("Prague", "city", 1827, 1357), ("Nurnberg", "city", 1667, 1345), ("Munich", "city", 1682, 1470),
    ("Vienna", "city", 1919, 1526), ("Berchtesgaden", "city", 1727, 1539), ("Cernauti", "city", 2505, 1515),
    ("Kirov", "city", 3365, 344), ("Vologda", "city", 3020, 504), ("Kazan", "city", 3514, 585),
    ("Yaroslavl", "city", 2996, 632), ("Gorki", "city", 3217, 658), ("Kalinin", "city", 2913, 740),
    ("Moscow", "capital-objective", 3019, 772), ("Vitebsk", "city", 2615, 858), ("Perma", "city", 4038, 504),
    ("Sverdlovsk", "city", 4223, 579), ("Ufa", "city", 3921, 698), ("Chelyabinsk", "city", 4300, 712),
    ("Kuibyshev", "city", 3608, 773), ("Magnitogorsk", "city", 4246, 845), ("Smolensk", "objective", 2749, 961),
    ("Tula", "city", 2996, 924), ("Bryansk", "city", 2868, 1075), ("Orel", "city", 2968, 1080),
    ("Kursk", "city", 2969, 1163), ("Stalingrad", "objective", 3477, 1257), ("Kiev", "city", 2662, 1295),
    ("Kharkov", "objective", 2960, 1322), ("Dnepropetrovsk", "objective", 2908, 1484), ("Stalino", "city", 3038, 1463),
    ("Elista", "city", 3394, 1448), ("Rostov", "port", 3173, 1526), ("Uralsk", "city", 3859, 1105),
    ("Orsk", "city", 4125, 1052), ("Astrakhan", "objective", 3677, 1528), ("Bilbao", "port", 754, 1583),
    ("Santander", "city", 700, 1618), ("Toulouse", "city", 971, 1687), ("Lyons", "objective", 1288, 1593),
    ("Turin", "city", 1397, 1660), ("Milan", "objective", 1505, 1650), ("Genoa", "objective-port", 1460, 1736),
    ("Marseilles", "objective-port", 1258, 1818), ("Spezia", "port", 1525, 1816), ("Florence", "city", 1586, 1812),
    ("Livorno", "port", 1552, 1908), ("Zaragoza", "city", 851, 1829), ("Barcelona", "city", 1040, 1893),
    ("Valencia", "port", 832, 1978), ("Palma", "port", 1032, 2053), ("Ajaccio", "port", 1415, 1975),
    ("Rome", "capital-objective", 1638, 2046), ("Cagliari", "port", 1443, 2165), ("Cartagena", "port", 742, 2137),
    ("Venice", "port", 1681, 1738), ("Trieste", "port", 1777, 1726), ("Graz", "city", 1915, 1611),
    ("Budapest", "capital-objective", 2052, 1622), ("Zagreb", "city", 1885, 1722), ("Belgrade", "capital-objective", 2092, 1815),
    ("Sarajevo", "city", 2046, 1890), ("Ragusa", "city", 2006, 1963), ("Cluj", "city", 2346, 1648),
    ("Kishinev", "city", 2608, 1693), ("Ploesti", "objective", 2415, 1812), ("Bucharest", "capital", 2453, 1878),
    ("Constanta", "port", 2613, 1903), ("Sofia", "capital", 2285, 2037), ("Plovdiv", "city", 2371, 2051),
    ("Istanbul", "objective-port", 2593, 2135), ("Naples", "port", 1752, 2125), ("Tirane", "capital", 2085, 2101),
    ("Brindisi", "port", 1958, 2179), ("Durazzo", "port", 2065, 2187), ("Taranto", "port", 1869, 2187),
    ("Odessa", "port", 2700, 1655), ("Sevastopol", "port", 2854, 1814), ("Maikop", "objective", 3235, 1747),
    ("Batum", "port", 3400, 1968), ("Samsun", "city", 2942, 2060), ("Grozny", "objective", 3696, 1737),
    ("Tiflis", "city", 3668, 1892), ("Krasnovodsk", "city", 4129, 1952), ("Algiers", "port", 955, 2337),
    ("Constantine", "city", 1164, 2386), ("Tunis", "port", 1431, 2413), ("Tripoli", "objective-port", 1619, 2786),
    ("Messina", "port", 1772, 2417), ("Syracuse", "city", 1796, 2478), ("Salonika", "city", 2281, 2184),
    ("Izmir", "port", 2550, 2342), ("Athens", "capital-port-objective", 2313, 2409), ("Malta", "objective-port", 1722, 2632),
    ("Suda Bay", "port", 2328, 2615), ("Ankara", "capital", 2871, 2184), ("Konya", "city", 2912, 2403),
    ("Antioch", "port", 3148, 2485), ("Aleppo", "city", 3219, 2462), ("Mosul", "objective", 3545, 2467),
    ("Famagusta", "port", 2995, 2614), ("Beirut", "port", 3105, 2718), ("Damascus", "capital", 3197, 2688),
    ("Mumanis", "city", 3422, 2688), ("Tabriz", "city", 3731, 2328), ("Bengasi", "city", 2044, 2919),
    ("Tobruk", "port", 2279, 2952), ("Buerat", "city", 1763, 2975), ("Alexandria", "objective-port", 2779, 3018),
    ("Cairo", "capital", 2829, 3079), ("Suez", "objective-port", 2926, 3099), ("Port Said", "port", 2923, 3005),
    ("Haifa", "port", 3093, 2848), ("Jerusalem", "capital", 3124, 2931), ("Amman", "capital", 3212, 2938),
    ("Kaf", "city", 3322, 2938), ("La Coruna", "port", 475, 1508), ("Vigo", "port", 440, 1631),
    ("Lisbon", "capital", 319, 1792), ("Madrid", "capital-objective", 638, 1804), ("Sevilla", "city", 465, 2055),
    ("Cordoba", "city", 545, 2048), ("Cadiz", "port", 431, 2102), ("Granada", "city", 581, 2108),
    ("Gibraltar", "objective-port", 450, 2175), ("Tangiers", "city", 468, 2250), ("Casablanca", "city", 265, 2395),
    ("Marrakech", "city", 191, 2488), ("Oran", "port", 698, 2344),
]

# Country seeds for the flood fill (one hex per separate landmass). Countries are as
# printed on the map at the start of play; colonies keep their own name.
COUNTRY_SEEDS = {
    "britain": ["K23", "B29", "E24", "F24", "K25", "AA7", "GG19", "GG34"], "ireland": ["H22"], "france": ["O22", "X20"],
    "spain": ["V12", "Y15", "Y16", "Z7", "BB7", "BB6"], "portugal": ["V8"],
    "belgium": ["M25"], "netherlands": ["K26"], "luxembourg": ["O25"], "germany": ["L31", "K36"],
    "denmark": ["I32", "I31", "G32", "F33", "I30"], "norway": ["C35"], "sweden": ["E37", "H36"], "finland": ["D41", "A45", "A46", "B45"],
    "baltic-states": ["H39", "F39"], "poland": ["M35"], "ussr": ["H47", "D43"],
    "hungary": ["S30"], "rumania": ["V32", "W35"], "bulgaria": ["Y30"], "yugoslavia": ["V29"], "albania": ["Z27"],
    "greece": ["DD27", "DD28", "EE28", "GG26", "GG27", "AA30"], "turkey": ["AA36", "Z33"], "italy": ["Y22", "Z19", "AA19", "DD20", "FF30"],
    "morocco": ["DD5"], "algeria": ["DD10"], "tunisia": ["FF15"], "libya": ["LL22"],
    "egypt": ["MM29", "NN26"], "palestine": ["KK34"], "transjordan": ["KK35"], "lebanon-syria": ["HH36"], "iraq": ["DD42"],
    "arabia": ["LL37"], "persia": ["DD45", "AA53", "BB52"],
}
# Borders that run through lakes, estuaries or gulfs, where no line is drawn on the hexside.
# (The vertical fold crease of the scan near x = 2230 px looks like a border to the line
# detector at P33-P34, R32-R33 and X29-X30; those are not borders.)
EXTRA_BORDERS = {"G42-H41", "F41-F42", "K26-L25", "JJ34-JJ35", "LL33-LL34", "NN32-NN33", "D42-D43", "C43-D43", "I37-J36"}

# Front of each country's land (Ref 4.4, cross-checked with the Objectives by Front in
# Ref 2.1). East Prussia and Bessarabia are split off by the red front line (see FRONT_SPLITS).
FRONT_OF_COUNTRY = {
    "western": ["britain", "ireland", "france", "belgium", "netherlands", "luxembourg", "germany", "denmark",
                "norway", "hungary"],
    "eastern": ["ussr", "poland", "baltic-states", "finland", "sweden"],
    "mediterranean": ["spain", "portugal", "italy", "yugoslavia", "albania", "greece", "bulgaria", "turkey",
                      "rumania", "morocco", "algeria", "tunisia", "libya", "egypt", "palestine", "transjordan",
                      "lebanon-syria", "iraq", "arabia", "persia"],
}
# (country, hex on the main side): hexes of the country cut off from it by a red front
# line get the other front. Germany -> East Prussia is Eastern; Rumania -> Bessarabia
# ("the Eastern Front portion of Rumania") is Eastern.
FRONT_SPLITS = [("germany", "L31", "eastern"), ("rumania", "V32", "eastern")]
# Colonies and islands in the Mediterranean belong to that front whatever their owner
# (Gibraltar and Malta are Mediterranean Objectives, Ref 2.1). Each entry covers the
# whole landmass of that country containing the hex.
FRONT_OVERRIDES = {"AA7": "mediterranean", "GG19": "mediterranean", "GG34": "mediterranean", "X20": "mediterranean"}

# Seas, for the front of all-sea hexes (coastal hexes take the front of their land,
# Ref 11.21). The red front lines run along the coasts: Atlantic and North Sea are
# Western; Baltic, Black Sea and Caspian are Eastern.
SEA_FRONT_SEEDS = {"western": ["J26", "P15"], "eastern": ["F37", "W38", "T51"], "mediterranean": ["FF22"]}
SEA_FRONT_OVERRIDES = {}

# Crossing arrows (Ref 4.6): Denmark x3, Scotland, Turkish Straits x2, Kerch, Messina.
CROSSING_ARROWS = ["I30-I31", "I31-I32", "F33-G32", "B29-C28", "Z33-Z34", "AA31-BB31", "U40-U41", "DD21-DD22"]

# Qattara Depression (Ref 4.51).
QATTARA_HEX = "NN26"
QATTARA_HEXSIDES = ["NN25-NN26", "NN26-NN27", "MM26-NN26", "MM27-NN26"]

# Suez Canal hexsides (Ref 4.3).
SUEZ_CANAL = ["LL30-LL31", "LL31-MM30", "MM30-MM31"]

# Ocean hexes with the green dot for fleet movement to and from the US Box (Ref 4.3).
US_BOX_ENTRY = ["E18", "F18", "G17", "H17", "I16", "J16", "K15", "L11", "L12", "L13", "L14", "M10", "N10",
                "O9", "P9", "Q8", "R8", "S7", "T7", "U6", "V6", "W5", "X5", "Y4", "Z4", "AA3", "BB3", "CC2"]

# Fortress hexes (Ref 4.8).
FORTRESSES = {
    "AA7": "permanent", "GG19": "permanent",                         # Gibraltar, Malta
    "P24": "maginot", "Q24": "maginot", "P25": "maginot",            # Metz, Strasbourg, P25
    "P26": "west-wall", "O26": "west-wall", "N26": "west-wall", "M27": "west-wall",  # Stuttgart, Frankfurt, Bonn, Essen
    "V38": "sevastopol",
    "D44": "standard",                                               # Leningrad (fortification symbols on the map)
}

# Land terrain corrections where colour sampling is misled. Solid-black land (e.g. the
# islands east of Athens in CC28/DD28, Ref 4.3) is never counted as land by extract.py.
# The Athens symbol sits on the tip of Attica just inside DD28 on the scan.
TERRAIN_OVERRIDES = {"NN26": "qattara-depression", "MM26": "plain"}

# Hexes where only a thin sliver of coastline crosses a hex corner; kept as land as
# measured, but to be checked against the original game.
SLIVERS = ["S42", "V39", "H26", "J29", "EE19", "KK25", "CC28"]
