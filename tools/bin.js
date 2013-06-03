var jsSrcDir = arguments[0];
var optionsFile = arguments[1];

var adhint = require('adhint');
var options = JSON.parse(readFile(optionsFile, 'UTF-8'));

var jsFiles = [];

var fileFilter = new java.io.FileFilter({
  accept: function(file) {
    if (file.isDirectory()) {
      file.listFiles(fileFilter);
      return false;
    }
    if (/.js$/.test(file.getName())) {
      jsFiles.push(file);
    }
    return false;
  }
});
new java.io.File(jsSrcDir).listFiles(fileFilter);

var findError = false;

jsFiles.forEach(function(file) {
  var path = file.getCanonicalPath();
  var info = adhint.parse(readFile(path, 'UTF-8'), path, options);
  info.toErrors().forEach(function(msg) {
    print(msg);
    findError = true;
  });
});

if (findError) {
  throw new Error('find error');
} else {
  print('complete');
}
