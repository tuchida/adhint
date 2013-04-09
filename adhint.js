var Token = org.mozilla.javascript.Token;
var bind = Function.prototype.bind;
var uncurryThis = bind.bind(bind.call);
var hasOwnProperty = uncurryThis(Object.prototype.hasOwnProperty);

var VarType = {
  VAR: 0,
  ARG: 1
};

function Scope(opt_parent) {
  this.vars = Object.create(opt_parent ? opt_parent.vars : null);
  this.parent = opt_parent;
}

Scope.prototype.def = function(name, node, type) {
  this.vars[name] = {
    refs: 0,
    node: node,
    type: type
  };
};

Scope.prototype.isDef = function(name) {
  return name in this.vars;
};

Scope.prototype.isDefThis = function(name) {
  return hasOwnProperty(this.vars, name);
};

Scope.prototype.ref = function(name) {
  var v = this.vars[name];
  if (v) {
    v.refs++;
    return true;
  }
  return false;
};

Scope.prototype.noRefs = function() {
  var vars = Object.keys(this.vars);
  var norefs = [];
  for (var i = 0, k; k = vars[i]; i++) {
    var v = this.vars[k];
    if (v.refs === 0) {
      norefs.push([k, v.node, v.type]);
    }
  }
  return norefs;
};

function resolveVariableName(node, scope) {
  var current = node;
  while (current) {
    switch (current.type) {
    case Token.GETPROP:
      if (current.getProperty().type == Token.NAME) {
        current = current.getTarget();
      } else {
        return null;
      }
      break;
    case Token.NAME:
      return String(current.toSource());
    default:
      return null;
    }
  }
}

function addReferenced(reporter, node, scope) {
  var varName = resolveVariableName(node);
  if (varName) {
    if (!scope.isDef(varName)) {
      reporter.addUndefined(varName, node);
    }
    scope.ref(varName);
  }
}

function format(fmt, obj) {
  return fmt.replace(/{([^}]*)}/g, function(_, name) {
    return obj[name];
  });
}

/**
 * @constructor
 */
function Reporter(file) {
  this.file = file;
  this.undefineds = [];
  this.noReferenced = [];
  this.doubleDefined = [];
}

Reporter.prototype.addUndefined = function(name, node) {
  this.undefineds.push({
    name: name,
    node: node.toSource(),
    line: node.getLineno(),
    file: this.file
  });
};

Reporter.prototype.addNoReferenced = function(name, node) {
  this.noReferenced.push({
    name: name,
    node: node.toSource(),
    line: node.getLineno(),
    file: this.file
  });
};

Reporter.prototype.addDoubleDefine = function(name, node) {
  this.doubleDefined.push({
    name: name,
    node: node.toSource(),
    line: node.getLineno(),
    file: this.file
  });
};

Reporter.prototype.toErrors = function() {
  var errors = [];
  this.undefineds.forEach(function(obj) {
    errors.push(format('"{name}" is undefined, ("{node}", file:{file}:{line})', obj));
  });
  this.noReferenced.forEach(function(obj) {
    errors.push(format('"{name}" is no referenced, ("{node}", file:{file}:{line})', obj));
  });
  this.doubleDefined.forEach(function(obj) {
    errors.push(format('"{name}" is already defined, ("{node}", file:{file}:{line})', obj));
  });
  return errors;
};

function Env(file, options) {
  this.reporter = new Reporter(file);
  this.options = options;
}

function enterNewScope(node, scope, args, noCheckArgs, env) {
  var newScope = new Scope(scope);
  var checkUnrefVar = env.options.checkUnrefType.indexOf('var') >= 0;
  var checkUnrefArg = env.options.checkUnrefType.indexOf('arg') >= 0;
  var noCheck = Object.create(null);
  args.forEach(function(p) {
    newScope.def(p.getIdentifier(), p, VarType.ARG);
    if (!checkUnrefArg) {
      noCheck[p.getIdentifier()] = 1;
    }
  });
  noCheckArgs.forEach(function(p) {
    newScope.def(p.getIdentifier(), p, VarType.ARG);
    noCheck[p.getIdentifier()] = 1;
  });
  node.visit(buildHoistingVisitor(node, newScope, env));
  node.visit(buildVisitor(node, newScope, env));
  newScope.noRefs().forEach(function([name, node, type]) {
    if (!noCheck[name] &&
        ((type === VarType.VAR && checkUnrefVar) ||
         (type === VarType.ARG && checkUnrefArg))) {
      env.reporter.addNoReferenced(name, node);
    }
  });
}

function buildVisitor(rootNode, scope, env) {
  return function(node) {
    switch (node.type) {
      //  Syntax.AssignmentExpression
    case Token.ASSIGN:
    case Token.ASSIGN_BITOR:
    case Token.ASSIGN_BITXOR:
    case Token.ASSIGN_BITAND:
    case Token.ASSIGN_LSH:
    case Token.ASSIGN_RSH:
    case Token.ASSIGN_URSH:
    case Token.ASSIGN_ADD:
    case Token.ASSIGN_SUB:
    case Token.ASSIGN_MUL:
    case Token.ASSIGN_DIV:
    case Token.ASSIGN_MOD:
      addReferenced(env.reporter, node.getLeft(), scope);
      addReferenced(env.reporter, node.getRight(), scope);
      break;

      // Syntax.ArrayExpression
    case Token.ARRAYLIT:
      for (var e in Iterator(node.getElements())) {
        addReferenced(env.reporter, e, scope);
      }
      break;

      // Syntax.CallExpression
      // Syntax.NewExpression
    case Token.CALL:
    case Token.NEW:
      addReferenced(env.reporter, node.getTarget(), scope);
      for (var arg in Iterator(node.getArguments())) {
        addReferenced(env.reporter, arg, scope);
      }
      break;

      // Syntax.ConditionalExpression
    case Token.HOOK:
      addReferenced(env.reporter, node.getTestExpression(), scope);
      addReferenced(env.reporter, node.getTrueExpression(), scope);
      addReferenced(env.reporter, node.getFalseExpression(), scope);
      break;

    case Token.EXPR_RESULT:
      addReferenced(env.reporter, node.getExpression(), scope);
      break;

      // Syntax.ExpressionStatement
      // Syntax.SwitchCase
      // Syntax.SwitchStatement
      // Syntax.ThrowStatement
    case Token.CASE:
    case Token.SWITCH:
    case Token.THROW:
      addReferenced(env.reporter, node.getExpression(), scope);
      break;

      // Syntax.ForInStatement
      // Syntax.ForStatement
    case Token.FOR:
      if (node instanceof org.mozilla.javascript.ast.ForInLoop) {
        addReferenced(env.reporter, node.getIterator(), scope);
        addReferenced(env.reporter, node.getIteratedObject(), scope);
      } else {
        addReferenced(env.reporter, node.getInitializer(), scope);
        addReferenced(env.reporter, node.getCondition(), scope);
        addReferenced(env.reporter, node.getIncrement(), scope);
      }
      break;

      // Syntax.DoWhileStatement
      // Syntax.IfStatement
      // Syntax.WhileStatement
    case Token.IF:
    case Token.WHILE:
    case Token.DO:
      addReferenced(env.reporter, node.getCondition(), scope);
      break;

      // Syntax.LogicalExpression

      // Syntax.Property
    case Token.COLON:
      addReferenced(env.reporter, node.getRight(), scope);
      break;

      // Syntax.ReturnStatement
    case Token.RETURN:
      addReferenced(env.reporter, node.getReturnValue(), scope);
      break;

      // Syntax.BinaryExpression
      // Syntax.SequenceExpression
      // Syntax.MultiplicativeExpression
      // Syntax.AdditiveExpression
    case Token.ADD:
    case Token.AND:
    case Token.COMMA:
    case Token.DIV:
    case Token.GE:
    case Token.GT:
    case Token.IN:
    case Token.INSTANCEOF:
    case Token.LE:
    case Token.LT:
    case Token.MOD:
    case Token.MUL:
    case Token.OR:
    case Token.SUB:
    case Token.EQ:
    case Token.NE:
    case Token.SHEQ:
    case Token.SHNE:
      addReferenced(env.reporter, node.getLeft(), scope);
      addReferenced(env.reporter, node.getRight(), scope);
      break;

      // Syntax.UnaryExpression
      // Syntax.UpdateExpression
    case Token.BITNOT:
    case Token.DEC:
    case Token.DELPROP:
    case Token.INC:
    case Token.NEG:
    case Token.NOT:
    case Token.POS:
    case Token.TYPEOF:
    case Token.VOID:
      addReferenced(env.reporter, node.getOperand(), scope);
      break;

      // Syntax.MemberExpression
    case Token.GETELEM:
      addReferenced(env.reporter, node.getTarget(), scope);
      addReferenced(env.reporter, node.getElement(), scope);
      break;

      // Syntax.VariableDeclarator
    case Token.EQ:
    case Token.NE:
    case Token.SHEQ:
    case Token.SHNE:

      // Syntax.VariableDeclarator
    case Token.CONST:
    case Token.VAR:
      if (node instanceof org.mozilla.javascript.ast.VariableInitializer) {
        addReferenced(env.reporter, node.getInitializer(), scope);
      }
      break;

    case Token.FUNCTION:
      if (rootNode !== node) {
        var args = [p for (p in Iterator(node.getParams()))];
        var fnName = node.getFunctionName();
        if (fnName != null) {
          if (node.getFunctionType() != org.mozilla.javascript.ast.FunctionNode.FUNCTION_STATEMENT) {
            args.push(fnName);
          }
        }
        enterNewScope(node, scope, args, [], env);
        return false;
      }
      break;

    case Token.CATCH:
      if (rootNode !== node) {
        enterNewScope(node, scope, [node.getVarName()], [], env);
        return false;
      }
      break;

    }
    return true;
  };
}

function buildHoistingVisitor(rootNode, scope, env) {
  return function(node) {
    switch (node.type) {
      // Syntax.VariableDeclarator
    case Token.CONST:
    case Token.VAR:
      if (node instanceof org.mozilla.javascript.ast.VariableInitializer) {
        var identName = node.getTarget().getIdentifier();
        if (scope.isDefThis(identName)) {
          env.reporter.addDoubleDefine(identName, node);
        }
        scope.def(identName, node, VarType.VAR);
      }
      break;

    case Token.FUNCTION:
      if (rootNode !== node) {
        var fnName = node.getFunctionName();
        if (fnName != null) {
          if (node.getFunctionType() == org.mozilla.javascript.ast.FunctionNode.FUNCTION_STATEMENT) {
            scope.def(fnName.getIdentifier(), fnName, VarType.VAR);
          }
        }
        return false;
      }
      break;
    }
    return true;
  };
}

function defaultOptions() {
  return {
    defaultGlobal: [
      // ECMAScript
      'Array', 'String', 'RegExp', 'Function', 'Number', 'Boolean', 'Math',
      'arguments', 'this', 'undefined',
      'parseInt', 'isNaN',

      // DOM
      'console', 'window', 'document', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'
    ],
    global: [],
    checkUnrefType: ['var', 'arg']
  };
}

function mixin(dest, src) {
  for (var k in src) {
    dest[k] = src[k];
  }
}

function parse(source, file, opt_options) {
  var ast = new org.mozilla.javascript.Parser().parse(source, file, 1);
  var options = defaultOptions();
  if (opt_options) {
    mixin(options, opt_options);
  }
  var env = new Env(file, options);
  var args = options.defaultGlobal.concat(options.global).map(function(name) {
    return new org.mozilla.javascript.ast.Name(-1, name);
  });
  enterNewScope(ast, null, [], args, env);
  return env.reporter;
}

exports.parse = parse;
