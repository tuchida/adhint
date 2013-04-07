'use struct';

function equalArray(a1, a2) {
  if (a1.length !== a2.length) {
    return false;
  }
  for (var i = 0, l = a1.length; i < l; i++) {
    if (a1[i] !== a2[i]) {
      return false;
    }
  }
  return true;
}

var adhint = require('../adhint.js');

var testFiles = new java.io.File('test/parse').listFiles(new java.io.FileFilter({
  accept: function(file) {
    return /.js$/.test(file.getName());
  }
}));

const parsedProperties = ['undefineds', 'noReferenced', 'doubleDefined'];

testFiles.forEach(function(file) {
  print(file.getName() + ':');
  var expect = {};
  parsedProperties.forEach(function(p) {
    expect[p] = [];
  });
  var path = file.getCanonicalPath();
  var source = readFile(path);
  source.replace(/(?:^|\n)\/\/ (undefineds|noReferenced|doubleDefined): (.*)(?=\r\n|$)/g, function(_, p, s) {
    expect[p].push(s);
    return _;
  });
  var info = adhint.parse(source, path);

  parsedProperties.forEach(function(p) {
    var names = info[p].map(function(o) {
      return ''+o.name;
    });
    if (!equalArray(expect[p], names)) {
      throw new Error('Test Failed\n' +
                      'Failed: ' + p + '\n' +
                      '  expect: ' + expect[p].join() + '\n' +
                      '  but: ' + names.join());
    }
  });
});
print('complite');
