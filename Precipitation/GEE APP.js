/***********************
 * ADMIN (GAUL) & KEYS *
 ***********************/
var ADMIN = ee.FeatureCollection('FAO/GAUL/2015/level2');
var COUNTRY_KEY = 'ADM0_NAME';
var DISTRICT_KEY = 'ADM2_NAME';

/****************
 * UI LAYOUT    *
 ****************/
ui.root.clear();
var map = ui.Map();
map.setOptions('HYBRID');

var title = ui.Label('Rainfall Frequency Analysis Tool', {fontWeight:'bold', fontSize:'20px'});
var hint = ui.Label('By Farhan Asaf Abir — Basin-based Rainfall Frequency Analysis', {color: 'navy'});

// Location inputs
var primaryLabel = ui.Label('Country');
var primarySelect = ui.Select({placeholder: 'Choose a Country…', disabled: true});
var secondaryLabel = ui.Label('District');
var secondarySelect = ui.Select({placeholder: 'Choose a District…', disabled: true});
var info = ui.Label('', {color: 'gray'});

// Basin selection
var basinHeader = ui.Label('— Basin Selection —', {fontWeight:'bold', margin:'12px 0 0 0'});
var basinLevelLabel = ui.Label('HydroSHEDS Basin Level:');
var basinLevelSelect = ui.Select({
  placeholder: 'Choose level…',
  items: ['Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5', 'Level 6', 'Level 7', 'Level 8', 'Level 9', 'Level 10', 'Level 11', 'Level 12'],
  value: 'Level 7'
});
var extractBasinBtn = ui.Button({
  label: 'Extract Basin from Selected Level', 
  style:{stretch:'horizontal', margin:'6px 0'}
});

// DEM clipping
var demHeader = ui.Label('— DEM Clipping —', {fontWeight:'bold', margin:'12px 0 0 0'});
var clipDemBtn = ui.Button({
  label: 'Clip MERIT DEM to Basin', 
  style:{stretch:'horizontal', margin:'6px 0'}
});

// CHIRPS date range
var chirpsHeader = ui.Label('— CHIRPS Data Range —', {fontWeight:'bold', margin:'12px 0 0 0'});
var startDateLabel = ui.Label('Start Date (YYYY-MM-DD):');
var startDateBox = ui.Textbox({placeholder: '1981-01-01', value: '1981-01-01'});
var endDateLabel = ui.Label('End Date (YYYY-MM-DD):');
var endDateBox = ui.Textbox({placeholder: '2024-12-31', value: '2024-12-31'});

// Maxima selection
var maximaHeader = ui.Label('— Analysis Parameters —', {fontWeight:'bold', margin:'12px 0 0 0'});
var maximaLabel = ui.Label('Select Maxima Type:');
var maximaSelect = ui.Select({
  placeholder: 'Choose maxima…',
  items: ['Annual', 'Monthly', 'Weekly'],
  value: 'Annual'
});

// Return periods
var returnPeriodLabel = ui.Label('Return Periods (years, comma-separated):');
var returnPeriodBox = ui.Textbox({
  placeholder: '2, 5, 10, 25, 50, 100', 
  value: '2, 5, 10, 25, 50, 100'
});

// Analysis buttons
var analysisHeader = ui.Label('— Run Analysis —', {fontWeight:'bold', margin:'12px 0 0 0'});
var computeBtn = ui.Button({
  label: 'Compute Gumbel Parameters', 
  style:{stretch:'horizontal', margin:'6px 0'}
});
var chartBtn = ui.Button({
  label: 'Show Frequency Curve Chart', 
  style:{stretch:'horizontal', margin:'6px 0'}
});
var showRasterBtn = ui.Button({
  label: 'Show Return Period Raster Maps', 
  style:{stretch:'horizontal', margin:'6px 0'}
});
var downloadBtn = ui.Button({
  label: 'Export Return Period Maps to Drive', 
  style:{stretch:'horizontal', margin:'6px 0'}
});

// Output panels
var outputPanel = ui.Panel([], null, {margin:'6px 0 0 0'});

var chartPanel = ui.Panel({
  widgets: [ ui.Label('Charts', {fontWeight:'bold', fontSize:'14px'}), ui.Label('No chart yet') ],
  style: { padding: '8px', border: '1px solid #ddd', margin: '6px 0' }
});

var consolePanel = ui.Panel({
  widgets: [ ui.Label('Console', {fontWeight:'bold', fontSize:'14px'}) ],
  layout: ui.Panel.Layout.flow('vertical'),
  style: { padding: '8px', border: '1px solid #ddd', backgroundColor: '#fafafa' }
});

var errorBody = ui.Label('', {color:'red'});
var errorPanel = ui.Panel([ui.Label('Errors', {fontWeight:'bold', color:'maroon'}), errorBody],
                          ui.Panel.Layout.flow('vertical'),
                          {padding:'8px', border: '1px solid #f3c2c2', backgroundColor:'#fff5f5'});

// Arrange left panel
var left = ui.Panel({
  widgets: [
    title, hint,
    ui.Label('— Location Selection —', {fontWeight:'bold', margin:'8px 0 0 0'}),
    primaryLabel, primarySelect,
    secondaryLabel, secondarySelect, info,
    basinHeader, basinLevelLabel, basinLevelSelect, extractBasinBtn,
    demHeader, clipDemBtn,
    chirpsHeader, startDateLabel, startDateBox, endDateLabel, endDateBox,
    maximaHeader, maximaLabel, maximaSelect, returnPeriodLabel, returnPeriodBox,
    analysisHeader, computeBtn, chartBtn, showRasterBtn, downloadBtn,
    outputPanel
  ],
  style: {width:'420px', padding:'8px'}
});

var right = ui.Panel({
  widgets: [ chartPanel, consolePanel, errorPanel ],
  style: {width:'420px', padding:'8px'}
});

var app = ui.SplitPanel({ 
  firstPanel: left, 
  secondPanel: ui.Panel([map, right], ui.Panel.Layout.flow('horizontal')), 
  orientation: 'horizontal', 
  style:{stretch:'both'}
});
ui.root.add(app);

/****************
 * HELPERS
 ****************/
function writeConsole(msg){ consolePanel.add(ui.Label('• ' + msg)); }
var _errors = [];
function writeError(msg){ _errors.push(String(msg)); errorBody.setValue('• ' + _errors.join('\n• ')); }
function clearErrors(){ _errors = []; errorBody.setValue(''); }

function safeEval(eeObj, onSuccess, context){
  try{
    eeObj.evaluate(function(v){
      try { onSuccess(v); }
      catch (e) { writeError((context? context+': ' : '') + (e && e.message ? e.message : e)); }
    }, function(err){
      writeError((context? context+': ' : '') + (err && err.message ? err.message : err));
    });
  } catch(e){ writeError((context? context+': ' : '') + (e && e.message ? e.message : e)); }
}

function pingServer(eeObj, context){
  try { safeEval(eeObj, function(){}, context || 'pingServer'); } catch(e){ writeError('pingServer: ' + e); }
}

function makeSafeRegion(fc, simplifyMeters){
  var tol = ee.Number(simplifyMeters);
  var simplifiedFC = ee.FeatureCollection(
    fc.map(function(f){
      var g = ee.Feature(f).geometry();
      g = ee.Algorithms.If(g, ee.Geometry(g).simplify(tol), null);
      return ee.Feature(f).setGeometry(g);
    })
  ).filter(ee.Filter.notNull(['system:index']));

  var dissolved = simplifiedFC.union(1);
  var geom = ee.FeatureCollection(dissolved).geometry();
  return ee.Geometry(geom);
}

function addMapLayer(layerObject, visParams, name){
  var layers = map.layers();
  for (var i=layers.length()-1; i>=0; --i){
    try{
      var layer = layers.get(i);
      if (layer.getName && layer.getName() === name){
        map.layers().remove(layer);
      }
    } catch(e){}
  }
  map.addLayer(layerObject, visParams, name);
}

function setChart(chartWidget){
  try {
    chartPanel.clear();
    chartPanel.add(ui.Label('Charts', {fontWeight:'bold', fontSize:'14px'}));
    chartPanel.add(chartWidget);
  } catch (err) {
    chartPanel.clear();
    chartPanel.add(ui.Label('Charts', {fontWeight:'bold', fontSize:'14px'}));
    chartPanel.add(ui.Label('Unable to render chart.'));
    writeError('Chart render failed: ' + (err && err.message ? err.message : err));
  }
}

/**********************
 * COUNTRY / DISTRICT
 **********************/
function populateCountries(){
  primarySelect.setDisabled(true);
  safeEval(ADMIN.aggregate_array(COUNTRY_KEY).distinct().sort(), function(values){
    values = (values || []).filter(function(v){ return v !== null; });
    primarySelect.items().reset(values);
    primarySelect.setDisabled(false);
    info.setValue('Choose a Country.');
  }, 'Load countries');
}

function populateDistricts(countryVal){
  secondarySelect.setDisabled(true);
  secondarySelect.items().reset([]);
  if (!countryVal) return;
  var filtered = ADMIN.filter(ee.Filter.eq(COUNTRY_KEY, countryVal));
  addMapLayer(filtered.style({color:'FF8800', fillColor:'00000000', width:1}), {}, 'Admin: ' + countryVal);
  pingServer(filtered.size(), 'Admin geometry check');

  safeEval(filtered.aggregate_array(DISTRICT_KEY).distinct().sort(), function(values){
    values = (values || []).filter(function(v){ return v !== null; });
    values.unshift('All');
    secondarySelect.items().reset(values);
    secondarySelect.setDisabled(false);
    secondarySelect.setValue('All', false);
    info.setValue('Country = ' + countryVal + '. Pick District or All.');
  }, 'Load districts');
}

primarySelect.onChange(function(val){ populateDistricts(val); });

secondarySelect.onChange(function(dVal){
  var cVal = primarySelect.getValue();
  if (!cVal) return;
  var base = ADMIN.filter(ee.Filter.eq(COUNTRY_KEY, cVal));
  var toShow = (dVal === 'All' || dVal == null) ? base : base.filter(ee.Filter.eq(DISTRICT_KEY, dVal));
  addMapLayer(toShow.style({color:'FF8800', fillColor:'00000000', width:1}), {}, 'Admin selection');
  pingServer(toShow.size(), 'Admin selection ping');
  safeEval(toShow.size(), function(n){ info.setValue('Showing ' + n + ' feature(s).'); }, 'Admin count');
});

/****************************************************
 * GLOBAL STATE VARIABLES
 ****************************************************/
var CURRENT_BASIN_FC = null;
var CURRENT_BASIN_GEOM = null;
var CURRENT_CLIPPED_DEM = null;
var CURRENT_CHIRPS = null;
var CURRENT_MAXIMA_COLLECTION = null;
var CURRENT_RETURN_STACK = null;
var CURRENT_GUMBEL_PARAMS = null;

/****************************************************
 * BASIN EXTRACTION
 ****************************************************/
extractBasinBtn.onClick(function(){
  clearErrors(); outputPanel.clear(); writeConsole('Extracting basins...');

  var country = primarySelect.getValue();
  if (!country){ 
    var m='Please select a Country first.'; 
    outputPanel.add(ui.Label(m)); 
    writeError(m); 
    return; 
  }
  
  var base = ADMIN.filter(ee.Filter.eq(COUNTRY_KEY, country));
  var district = secondarySelect.getValue();
  var fc = (district && district !== 'All') ? base.filter(ee.Filter.eq(DISTRICT_KEY, district)) : base;
  
  var region = makeSafeRegion(fc, 1000);
  pingServer(region.area(1), 'Admin region build');

  // Get basin level
  var levelStr = basinLevelSelect.getValue() || 'Level 7';
  var levelNum = parseInt(levelStr.split(' ')[1]);
  var basinPath = 'WWF/HydroSHEDS/v1/Basins/hybas_' + levelNum;
  
  writeConsole('Using basin level: ' + levelNum);
  
  var basins = ee.FeatureCollection(basinPath).filterBounds(region);

  safeEval(basins.size(), function(n){
    if (!n || n === 0){
      var msg = 'No HydroBASINS intersect the selected admin region.';
      outputPanel.add(ui.Label(msg));
      writeConsole(msg);
      return;
    }

    CURRENT_BASIN_FC = basins;
    var mergedGeom = makeSafeRegion(basins, 100);
    CURRENT_BASIN_GEOM = mergedGeom;

    addMapLayer(basins.style({color:'0088FF', fillColor:'00000000', width:1}), {}, 'Basins (individual)');
    var mergedFeature = ee.Feature(CURRENT_BASIN_GEOM);
    var mergedFC = ee.FeatureCollection([mergedFeature]);
    addMapLayer(mergedFC.style({color:'FF8800', fillColor:'00000000', width:2}), {}, 'Basins (merged)');

    try { map.centerObject(mergedFC, 8); } catch(e){}

    writeConsole('Number of basins: ' + n);
    safeEval(ee.Number(mergedGeom.area()).divide(1e6).format('%.2f'), function(a){
      outputPanel.add(ui.Label('Basins extracted — area: ' + a + ' km²', {fontWeight:'bold'}));
      writeConsole('Basin area: ' + a + ' km²');
    }, 'Merged area');

  }, 'Basins size');
});

/****************************************************
 * DEM CLIPPING
 ****************************************************/
clipDemBtn.onClick(function(){
  clearErrors(); outputPanel.clear(); writeConsole('Clipping MERIT DEM...');

  if (!CURRENT_BASIN_GEOM){
    var m='No basin geometry. Extract basins first.';
    outputPanel.add(ui.Label(m)); 
    writeError(m); 
    return;
  }

  var merit = ee.Image('MERIT/DEM/v1_0_3').select('dem');
  var clipped = merit.clip(CURRENT_BASIN_GEOM);
  CURRENT_CLIPPED_DEM = clipped;

  var minmax = clipped.reduceRegion({
    reducer: ee.Reducer.minMax(),
    geometry: CURRENT_BASIN_GEOM,
    scale: 90,
    maxPixels: 1e13
  });

  safeEval(minmax, function(mm){
    var minVal = mm.dem_min || 0;
    var maxVal = mm.dem_max || 1000;
    
    addMapLayer(clipped, {min: minVal, max: maxVal, palette: ['#004D00', '#008000', '#FFFF00', '#FF8000', '#FF0000', '#FFFFFF']}, 'MERIT DEM (clipped)');

    try {
      var mergedFC = ee.FeatureCollection([ee.Feature(CURRENT_BASIN_GEOM)]);
      map.centerObject(mergedFC, 9);
    } catch(e){}

    outputPanel.add(ui.Label('MERIT DEM clipped (min: ' + minVal.toFixed(1) + 'm, max: ' + maxVal.toFixed(1) + 'm)', {fontWeight:'bold'}));
    writeConsole('DEM clipped successfully');
  }, 'DEM min/max');
});

/****************************************************
 * GUMBEL COMPUTATION
 ****************************************************/
function parseReturnPeriods(){
  var rpStr = returnPeriodBox.getValue() || '2, 5, 10, 25, 50, 100';
  var parts = rpStr.split(',').map(function(s){ return parseFloat(s.trim()); });
  return parts.filter(function(v){ return !isNaN(v) && v > 0; });
}

function calculateGumbelParams(collection) {
  var meanImage = collection.mean();
  var stdImage = collection.reduce(ee.Reducer.stdDev());
  var countImage = collection.count();
  
  var euler = 0.5772156649015329;
  var beta = stdImage.multiply(Math.sqrt(6)).divide(Math.PI);
  var mu = meanImage.subtract(beta.multiply(euler));
  
  return ee.Image.cat([mu, beta, meanImage, stdImage, countImage])
    .rename(['mu', 'beta', 'mean', 'stdDev', 'count']);
}

function calculateReturnLevel(T, params) {
  var mu = params.select('mu');
  var beta = params.select('beta');
  var prob = ee.Image(1).subtract(ee.Image(1).divide(T));
  var term = prob.log().multiply(-1).log();
  return mu.subtract(beta.multiply(term)).rename('T' + T + 'yr');
}

computeBtn.onClick(function(){
  clearErrors(); outputPanel.clear(); writeConsole('Computing maxima series and Gumbel parameters...');

  if (!CURRENT_BASIN_GEOM){
    var m='No basin geometry. Extract basins first.';
    outputPanel.add(ui.Label(m)); 
    writeError(m); 
    return;
  }

  // Parse dates
  var startStr = startDateBox.getValue() || '1981-01-01';
  var endStr = endDateBox.getValue() || '2024-12-31';
  var startDate = ee.Date(startStr);
  var endDate = ee.Date(endStr);

  // Load CHIRPS
  writeConsole('Loading CHIRPS from ' + startStr + ' to ' + endStr);
  var chirps = ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY')
    .filterDate(startDate, endDate.advance(1, 'day'))
    .filterBounds(CURRENT_BASIN_GEOM)
    .select('precipitation');

  CURRENT_CHIRPS = chirps;

  // Get maxima type
  var maximaType = maximaSelect.getValue() || 'Annual';
  var startYear = startDate.get('year');
  var endYear = endDate.get('year');
  var years = ee.List.sequence(startYear, endYear);

  var maximaCollection;

  if (maximaType === 'Annual') {
    var annualMaxImages = years.map(function(year) {
      var start = ee.Date.fromYMD(ee.Number(year), 1, 1);
      var end = start.advance(1, 'year');
      var yearlyMax = chirps.filterDate(start, end).max().clip(CURRENT_BASIN_GEOM).set('year', year);
      return yearlyMax;
    });
    maximaCollection = ee.ImageCollection.fromImages(annualMaxImages);
    
  } else if (maximaType === 'Monthly') {
    var months = ee.List.sequence(1, 12);
    var monthlyMaxImages = years.map(function(year) {
      return months.map(function(month) {
        var start = ee.Date.fromYMD(ee.Number(year), ee.Number(month), 1);
        var end = start.advance(1, 'month');
        var monthlyMax = chirps.filterDate(start, end).max().clip(CURRENT_BASIN_GEOM)
          .set('year', year).set('month', month);
        return monthlyMax;
      });
    }).flatten();
    maximaCollection = ee.ImageCollection.fromImages(monthlyMaxImages);
    
  } else { // Weekly
    var weeklyMaxImages = years.map(function(year) {
      var start = ee.Date.fromYMD(ee.Number(year), 1, 1);
      var end = start.advance(1, 'year');
      var weeks = ee.List.sequence(0, end.difference(start, 'week').subtract(1))
        .map(function(w) { return start.advance(w, 'week'); });
      
      return weeks.map(function(weekStart) {
        weekStart = ee.Date(weekStart);
        var weekEnd = weekStart.advance(1, 'week');
        var weeklyMax = chirps.filterDate(weekStart, weekEnd).max().clip(CURRENT_BASIN_GEOM)
          .set('year', year).set('week', weekStart.getRelative('week', 'year'));
        return weeklyMax;
      });
    }).flatten();
    maximaCollection = ee.ImageCollection.fromImages(weeklyMaxImages);
  }

  CURRENT_MAXIMA_COLLECTION = maximaCollection;

  // Calculate Gumbel parameters
  var params = calculateGumbelParams(maximaCollection);
  CURRENT_GUMBEL_PARAMS = params;

  // Calculate return levels
  var T_list = parseReturnPeriods();
  
  // Convert T to appropriate units
  var T_adjusted;
  if (maximaType === 'Monthly') {
    T_adjusted = T_list.map(function(t){ return t * 12; });
  } else if (maximaType === 'Weekly') {
    T_adjusted = T_list.map(function(t){ return t * 52; });
  } else {
    T_adjusted = T_list;
  }

  var returnPeriods = T_adjusted.map(function(T) {
    return calculateReturnLevel(T, params);
  });
  
  var returnStack = ee.Image.cat(returnPeriods);
  CURRENT_RETURN_STACK = returnStack;

  safeEval(maximaCollection.size(), function(n){
    outputPanel.add(ui.Label('Gumbel parameters computed for ' + maximaType + ' maxima', {fontWeight:'bold'}));
    outputPanel.add(ui.Label('Total ' + maximaType.toLowerCase() + ' periods: ' + n));
    writeConsole('Computed ' + n + ' ' + maximaType.toLowerCase() + ' maxima');
    writeConsole('Return periods: ' + T_list.join(', ') + ' years');
  }, 'Maxima count');
});

/****************************************************
 * FREQUENCY CURVE CHART
 ****************************************************/
chartBtn.onClick(function(){
  clearErrors(); outputPanel.clear(); writeConsole('Generating frequency curve...');

  if (!CURRENT_MAXIMA_COLLECTION || !CURRENT_BASIN_GEOM){
    var m='No maxima collection computed. Click "Compute Gumbel Parameters" first.';
    outputPanel.add(ui.Label(m)); 
    writeError(m); 
    return;
  }

  var maximaType = maximaSelect.getValue() || 'Annual';
  var valueProperty = maximaType.toLowerCase() + '_max_mm';
  
  // Convert maxima to features with basin-average values
  var years = CURRENT_MAXIMA_COLLECTION.aggregate_array('year').distinct();
  
  var featureList = CURRENT_MAXIMA_COLLECTION.toList(CURRENT_MAXIMA_COLLECTION.size());
  var n = CURRENT_MAXIMA_COLLECTION.size();
  
  // Create feature collection with basin-averaged values
  var amsFC = ee.FeatureCollection(
    ee.List.sequence(0, n.subtract(1)).map(function(i){
      var img = ee.Image(featureList.get(i));
      var value = img.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: CURRENT_BASIN_GEOM,
        scale: 5000,
        maxPixels: 1e13
      }).get('precipitation');
      return ee.Feature(null, {'value': value});
    })
  ).filter(ee.Filter.notNull(['value']));

  // Calculate Gumbel parameters from basin averages
  var stats = amsFC.reduceColumns(
    ee.Reducer.mean().combine({reducer2: ee.Reducer.stdDev(), sharedInputs: true})
      .combine({reducer2: ee.Reducer.count(), sharedInputs: true}),
    ['value']
  );

  var xbar = ee.Number(stats.get('mean'));
  var s = ee.Number(stats.get('stdDev'));
  var nVal = ee.Number(stats.get('count'));
  
  var euler = ee.Number(0.5772156649015329);
  var beta = s.multiply(Math.sqrt(6)).divide(Math.PI);
  var mu = xbar.subtract(euler.multiply(beta));

  // Get return periods
  var T_list = parseReturnPeriods();
  var timeUnit = maximaType === 'Monthly' ? 'months' : (maximaType === 'Weekly' ? 'weeks' : 'years');
  
  var T_adjusted;
  if (maximaType === 'Monthly') {
    T_adjusted = T_list.map(function(t){ return t * 12; });
  } else if (maximaType === 'Weekly') {
    T_adjusted = T_list.map(function(t){ return t * 52; });
  } else {
    T_adjusted = T_list;
  }

  // Gumbel fitted values
  var rpList = T_adjusted.map(function(T, idx) {
    T = ee.Number(T);
    var pNonExc = ee.Number(1).subtract(ee.Number(1).divide(T));
    var term = pNonExc.log().multiply(-1).log();
    var xT = mu.subtract(beta.multiply(term));
    
    return ee.Feature(null, {
      'T_years': T_list[idx], 
      'xT_mm': xT, 
      'source': 'Gumbel'
    });
  });
  var rpFC = ee.FeatureCollection(rpList);

  // Empirical Weibull
  var sortedList = amsFC.sort('value', false).toList(amsFC.size());
  var empList = ee.List.sequence(1, nVal).map(function(rank) {
    rank = ee.Number(rank);
    var f = ee.Feature(sortedList.get(rank.subtract(1)));
    var value = ee.Number(f.get('value'));
    var prob = rank.divide(nVal.add(1));
    var T = ee.Number(1).divide(ee.Number(1).subtract(prob));
    
    var T_years = maximaType === 'Monthly' ? T.divide(12) : 
                  maximaType === 'Weekly' ? T.divide(52) : T;
    
    return ee.Feature(null, {
      'T_years': T_years,
      'xT_mm': value, 
      'source': 'Empirical'
    });
  });
  var empFC = ee.FeatureCollection(empList);

  // Create chart
  var freqChart = ui.Chart.feature.groups({
    features: rpFC.merge(empFC),
    xProperty: 'T_years',
    yProperty: 'xT_mm',
    seriesProperty: 'source'
  })
  .setChartType('ScatterChart')
  .setOptions({
    title: maximaType + ' Rainfall Frequency Curve',
    hAxis: {title: 'Return Period (years)', logScale: true},
    vAxis: {title: 'Rainfall (mm)'},
    pointSize: 6,
    lineWidth: 2,
    series: {
      0: {color: 'blue', lineWidth: 2, pointSize: 6, pointShape: 'circle'},
      1: {color: 'red', lineWidth: 0, pointSize: 8, pointShape: 'diamond'}
    }
  });

  setChart(freqChart);
  outputPanel.add(ui.Label('Frequency curve displayed in Charts panel', {fontWeight:'bold'}));
  writeConsole('Frequency curve chart created');
});

/****************************************************
 * SHOW RASTER MAPS
 ****************************************************/
showRasterBtn.onClick(function(){
  clearErrors(); outputPanel.clear(); writeConsole('Displaying return period rasters...');

  if (!CURRENT_RETURN_STACK){
    var m='No return period maps computed. Click "Compute Gumbel Parameters" first.';
    outputPanel.add(ui.Label(m)); 
    writeError(m); 
    return;
  }

  var T_list = parseReturnPeriods();
  var precipPalette = ['#000080', '#0000FF', '#00FFFF', '#00FF00', '#FFFF00', '#FF8000', '#FF0000', '#800000'];
  
  var maximaType = maximaSelect.getValue() || 'Annual';
  
  // Adjust band names based on maxima type
  var T_adjusted;
  if (maximaType === 'Monthly') {
    T_adjusted = T_list.map(function(t){ return t * 12; });
  } else if (maximaType === 'Weekly') {
    T_adjusted = T_list.map(function(t){ return t * 52; });
  } else {
    T_adjusted = T_list;
  }

  // Add each return period as a layer
  T_adjusted.forEach(function(T, i){
    var bandName = 'T' + T + 'yr';
    var displayName = maximaType + ' T=' + T_list[i] + 'yr';
    var visible = (i === T_list.length - 1); // Only show the last one by default
    
    addMapLayer(
      CURRENT_RETURN_STACK.select(bandName), 
      {min: 30, max: 200, palette: precipPalette}, 
      displayName,
      visible
    );
  });

  try {
    var mergedFC = ee.FeatureCollection([ee.Feature(CURRENT_BASIN_GEOM)]);
    map.centerObject(mergedFC, 9);
  } catch(e){}

  outputPanel.add(ui.Label('Return period maps added to map (check Layers panel)', {fontWeight:'bold'}));
  writeConsole('Added ' + T_list.length + ' return period layers');
});

/****************************************************
 * EXPORT TO DRIVE
 ****************************************************/
downloadBtn.onClick(function(){
  clearErrors(); outputPanel.clear(); writeConsole('Exporting return period maps to Google Drive...');

  if (!CURRENT_RETURN_STACK || !CURRENT_BASIN_GEOM){
    var m='No return period maps or basin geometry. Compute Gumbel parameters first.';
    outputPanel.add(ui.Label(m)); 
    writeError(m); 
    return;
  }

  var maximaType = maximaSelect.getValue() || 'Annual';
  var startStr = startDateBox.getValue() || '1981-01-01';
  var endStr = endDateBox.getValue() || '2024-12-31';
  
  var startYear = startStr.split('-')[0];
  var endYear = endStr.split('-')[0];
  
  var description = maximaType + '_ReturnPeriod_' + startYear + '_' + endYear;

  Export.image.toDrive({
    image: CURRENT_RETURN_STACK,
    description: description,
    region: CURRENT_BASIN_GEOM,
    scale: 5000,
    maxPixels: 1e13,
    fileFormat: 'GeoTIFF'
  });

  outputPanel.add(ui.Label('Export task created: ' + description, {fontWeight:'bold'}));
  outputPanel.add(ui.Label('Check the Tasks tab (top-right) to run the export.'));
  writeConsole('Export task submitted: ' + description);
  writeConsole('Go to Tasks tab and click RUN to start the export');
});

/****************************************************
 * INITIALIZE
 ****************************************************/
populateCountries();
writeConsole('Ready — Select Country, District, Basin Level, and Extract Basin to begin.');
writeConsole('Then clip DEM, set date range, and run analysis.');
