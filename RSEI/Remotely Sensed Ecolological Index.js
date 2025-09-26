/*******************************************************
 RSEI (PCA) — FIXED GEE script for Gazipur (FAO GAUL)
 - Landsat C2 L2 for spectral indices
 - MODIS MOD11A2 for LST (resampled to Landsat)
 - Standardization + PCA -> RSEI normalized 0..1
 FIXES: correlation keys, array indexing, memory optimization
*******************************************************/

// ----------------------------
// PARAMETERS (optimized for memory)
// ----------------------------
var startDate = '2015-01-01';
var endDate   = '2015-12-31';
var cloudMaskQAThreshold = 0;
var analysisScale = 60; // Increased from 30 to reduce memory usage
var gaulLevel = 'level2';
var districtName = 'Gazipur';

// ----------------------------
// 1) Load FAO GAUL and select Gazipur AOI
// ----------------------------
var gaulFC = ee.FeatureCollection('FAO/GAUL/2015/' + gaulLevel);

function findGazipur(fc, name) {
  var f = fc.filter(ee.Filter.or(
    ee.Filter.eq('ADM2_NAME', name),
    ee.Filter.eq('ADM2_EN', name),
    ee.Filter.stringContains('ADM2_NAME', name),
    ee.Filter.stringContains('ADM2_EN', name),
    ee.Filter.eq('ADM1_NAME', name),
    ee.Filter.eq('ADM1_EN', name),
    ee.Filter.stringContains('ADM1_NAME', name),
    ee.Filter.stringContains('ADM1_EN', name)
  )).first();

  f = ee.Algorithms.If(f, f, fc.filter(ee.Filter.stringContains('ADM2_NAME', name)).first());
  return ee.Feature(f);
}

var gazipur = findGazipur(gaulFC, districtName);
gazipur = ee.Feature(ee.Algorithms.If(gazipur, gazipur,
  gaulFC.filter(ee.Filter.stringContains('ADM1_NAME', 'Dhaka')).first()
));

var gazipur_fc = ee.FeatureCollection([gazipur]);
Map.centerObject(gazipur_fc, 10);
Map.addLayer(gazipur_fc.style({color: 'FF0000', width: 2}), {}, 'Gazipur (GAUL)');

// ----------------------------
// 2) Landsat Collection-2 Level-2 (SR) processing
// ----------------------------
var l8sr = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
  .filterBounds(gazipur.geometry())
  .filterDate(startDate, endDate);

function maskL8sr(image) {
  var qa = image.select('QA_PIXEL');
  var cloudBit = 1 << 3;
  var cloudShadowBit = 1 << 4;
  var mask = qa.bitwiseAnd(cloudBit).eq(0)
               .and(qa.bitwiseAnd(cloudShadowBit).eq(0));
  return image.updateMask(mask);
}

var l8srMasked = l8sr.map(maskL8sr);
print('Landsat C2 L2 images count (masked):', l8srMasked.size());

var medianL8 = l8srMasked.median().clip(gazipur.geometry());
Map.addLayer(medianL8, {bands: ['SR_B4', 'SR_B3', 'SR_B2'], min:0, max:0.2}, 'Landsat C2 L2 RGB (median)');

// ----------------------------
// 3) Compute component indices
// ----------------------------

// A) NDVI
var ndvi = medianL8.normalizedDifference(['SR_B5', 'SR_B4']).rename('NDVI');

// B) Tasseled-Cap Wetness
var wet = medianL8.expression(
  '0.1511*b2 + 0.1973*b3 + 0.3283*b4 + 0.3407*b5 - 0.7117*b6 - 0.4559*b7',
  {
    'b2': medianL8.select('SR_B2'),
    'b3': medianL8.select('SR_B3'),
    'b4': medianL8.select('SR_B4'),
    'b5': medianL8.select('SR_B5'),
    'b6': medianL8.select('SR_B6'),
    'b7': medianL8.select('SR_B7')
  }
).rename('WET');

// C) NDBSI
var ndbi = medianL8.normalizedDifference(['SR_B6', 'SR_B5']).rename('NDBI');
var bsi = medianL8.expression(
  '((swir + red) - (nir + blue)) / ((swir + red) + (nir + blue))',
  {
    'swir': medianL8.select('SR_B6'),
    'red' : medianL8.select('SR_B4'),
    'nir' : medianL8.select('SR_B5'),
    'blue': medianL8.select('SR_B2')
  }
).rename('BSI');

var ndbsi = ndbi.add(bsi).multiply(0.5).rename('NDBSI');

// Add layers for visualization
Map.addLayer(ndvi, {min: -0.2, max: 0.8}, 'NDVI');
Map.addLayer(ndbsi, {min: -1, max: 1}, 'NDBSI');

// ----------------------------
// 4) LST from MODIS (with reduced scale for memory)
// ----------------------------
var modisLSTcol = ee.ImageCollection('MODIS/061/MOD11A2')
  .filterDate(startDate, endDate)
  .filterBounds(gazipur.geometry())
  .select('LST_Day_1km');

print('MODIS MOD11A2 images count:', modisLSTcol.size());

var lstModisMedian = modisLSTcol.median()
  .multiply(0.02).subtract(273.15).rename('LST_MODIS');

var landsatProj = medianL8.select('SR_B4').projection();
var lst_resampled = lstModisMedian.reproject({crs: landsatProj.crs(), scale: analysisScale}).clip(gazipur.geometry());

Map.addLayer(lst_resampled, {min: 20, max: 40}, 'LST (MODIS resampled °C)');

// ----------------------------
// 5) Compose and standardize indicators
// ----------------------------
var indicators = ee.Image.cat([ndvi, wet, ndbsi, lst_resampled])
  .rename(['NDVI', 'WET', 'NDBSI', 'LST']).toFloat();
var bandNames = indicators.bandNames();
print('Indicator band order:', bandNames);

// Use sampling to reduce memory load for statistics
var sample = indicators.sample({
  region: gazipur.geometry(),
  scale: analysisScale,
  numPixels: 5000,  // Limit sample size
  seed: 42,
  geometries: false
});

// Calculate statistics for each band individually
var ndviMean = sample.reduceColumns(ee.Reducer.mean(), ['NDVI']).get('mean');
var wetMean = sample.reduceColumns(ee.Reducer.mean(), ['WET']).get('mean');
var ndbsiMean = sample.reduceColumns(ee.Reducer.mean(), ['NDBSI']).get('mean');
var lstMean = sample.reduceColumns(ee.Reducer.mean(), ['LST']).get('mean');

var ndviStd = sample.reduceColumns(ee.Reducer.stdDev(), ['NDVI']).get('stdDev');
var wetStd = sample.reduceColumns(ee.Reducer.stdDev(), ['WET']).get('stdDev');
var ndbsiStd = sample.reduceColumns(ee.Reducer.stdDev(), ['NDBSI']).get('stdDev');
var lstStd = sample.reduceColumns(ee.Reducer.stdDev(), ['LST']).get('stdDev');

print('Individual means - NDVI:', ndviMean, 'WET:', wetMean, 'NDBSI:', ndbsiMean, 'LST:', lstMean);
print('Individual stds - NDVI:', ndviStd, 'WET:', wetStd, 'NDBSI:', ndbsiStd, 'LST:', lstStd);

// Build standardization images using individual values
var means = ee.Image.constant([ndviMean, wetMean, ndbsiMean, lstMean]).rename(bandNames);
var stds = ee.Image.constant([ndviStd, wetStd, ndbsiStd, lstStd]).rename(bandNames);

var stdsSafe = stds.where(stds.lte(0), ee.Image.constant(1e-6));
var standardized = indicators.subtract(means).divide(stdsSafe).rename(bandNames);

// ----------------------------
// 6) PCA implementation (FIXED covariance calculation)
// ----------------------------
// Convert standardized image to 1D array format for covariance
var arrayImage1D = standardized.toArray();

// Use reduceRegion with centeredCovariance on the array image
var covDict = arrayImage1D.reduceRegion({
  reducer: ee.Reducer.centeredCovariance(),
  geometry: gazipur.geometry(),
  scale: analysisScale,
  maxPixels: 1e9,
  bestEffort: true
});

var covArray = ee.Array(covDict.get('array'));
print('Covariance matrix:', covArray);

// Eigen decomposition (FIXED indexing)
var eigens = covArray.eigen();
var eigenValues = eigens.slice(1, 0, 1);  // First column = eigenvalues
var eigenVectors = eigens.slice(1, 1);     // Remaining columns = eigenvectors
print('Eigenvalues:', eigenValues);
print('Eigenvectors:', eigenVectors);

// Project to PC space
var arrayImage2D = standardized.toArray().toArray(1);
var PCs = ee.Image(eigenVectors).matrixMultiply(arrayImage2D);
var pcNames = ['PC1', 'PC2', 'PC3', 'PC4'];
var pcImage = PCs.arrayProject([0]).arrayFlatten([pcNames]);

// ----------------------------
// 7) FIXED correlation calculation and RSEI normalization
// ----------------------------
// Create a combined image for correlation
var correlationImage = pcImage.select('PC1').addBands(ndvi);

// Sample for correlation calculation
var correlationSample = correlationImage.sample({
  region: gazipur.geometry(),
  scale: analysisScale,
  numPixels: 1000,
  seed: 42,
  geometries: false
});

var corrDict = correlationSample.reduceColumns({
  reducer: ee.Reducer.pearsonsCorrelation(),
  selectors: ['PC1', 'NDVI']
});

print('Correlation dictionary:', corrDict);
var corrVal = ee.Number(corrDict.get('correlation'));
print('PC1-NDVI correlation:', corrVal);

// Determine RSEI orientation
var rseiRaw = ee.Algorithms.If(
  corrVal.gt(0),
  pcImage.select('PC1'),
  pcImage.select('PC1').multiply(-1)
);
rseiRaw = ee.Image(rseiRaw).rename('RSEI_raw');

// Normalize to 0..1 using sampling
var rseiSample = rseiRaw.sample({
  region: gazipur.geometry(),
  scale: analysisScale,
  numPixels: 2000,
  seed: 42,
  geometries: false
});

var rseiMinMax = rseiSample.reduceColumns({
  reducer: ee.Reducer.minMax(),
  selectors: ['RSEI_raw']
});

var rMin = ee.Number(rseiMinMax.get('min'));
var rMax = ee.Number(rseiMinMax.get('max'));
var rRange = rMax.subtract(rMin);
rRange = ee.Algorithms.If(rRange.lte(0), 1, rRange);

var rsei = rseiRaw.subtract(rMin).divide(ee.Number(rRange)).rename('RSEI');

Map.addLayer(rsei, {min:0, max:1, palette: ['red','yellow','green']}, 'RSEI (0..1)');

// ----------------------------
// 8) Final diagnostics (FIXED eigenvalue calculations)
// ----------------------------
var rseiMeanSample = rsei.sample({
  region: gazipur.geometry(),
  scale: analysisScale,
  numPixels: 2000,
  seed: 42,
  geometries: false
});

var rseiMean = rseiMeanSample.reduceColumns({
  reducer: ee.Reducer.mean(),
  selectors: ['RSEI']
});

print('Mean RSEI (sampled):', rseiMean.get('mean'));

// PC1 explained variance (FIXED - proper 2D array indexing)
var totalVar = eigenValues.reduce(ee.Reducer.sum(), [0]).get([0, 0]); // 2D array indexing
var pc1Var = eigenValues.get([0, 0]); // Get first eigenvalue as scalar
var pc1ExplainedPct = ee.Number(pc1Var).divide(ee.Number(totalVar)).multiply(100);
print('PC1 explained variance (%):', pc1ExplainedPct);

// PC1 loadings (first column of eigenvectors)
var pc1Loadings = eigenVectors.slice(0, 0, 1);  // First column
print('PC1 loadings (order = NDVI, WET, NDBSI, LST):', pc1Loadings);

// Summary diagnostics
var diagnostics = ee.Dictionary({
  'Landsat_count': l8srMasked.size(),
  'MODIS_count': modisLSTcol.size(),
  'Mean_RSEI': rseiMean.get('mean'),
  'PC1_explained_pct': pc1ExplainedPct,
  'PC1_NDVI_correlation': corrVal
});
print('Key diagnostics summary:', diagnostics);

// END OF FIXED SCRIPT
