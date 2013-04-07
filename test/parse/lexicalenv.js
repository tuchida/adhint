var foo = {
  foo1: {
    foo2: 12
  }
};

function(b) {
  function(c) {
    return c.baz1.baz;
  }
  return foo.foo1.foo2 + b.bar1.bar2 + c.baz2.baz;
}

try {
} catch(error) {
  error.message.toString();
}

// undefineds: c
