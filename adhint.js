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
    if (v.refs === 0
        /* && [xxx].contains(v.type) */ &&
        v.node.getLineno() != -1) {  // TODO : extract default property
      norefs.push([k, v.node]);
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

function addReferenced(parsed, node, scope) {
  var varName = resolveVariableName(node);
  if (varName) {
    if (!scope.isDef(varName)) {
      parsed.addUndefined(varName, node);
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
function Parsed(file) {
  this.file = file;
  this.undefineds = [];
  this.noReferenced = [];
  this.doubleDefined = [];
}

Parsed.prototype.addUndefined = function(name, node) {
  this.undefineds.push({
    name: name,
    node: node.toSource(),
    line: node.getLineno(),
    file: this.file
  });
};

Parsed.prototype.addNoReferenced = function(name, node) {
  this.noReferenced.push({
    name: name,
    node: node.toSource(),
    line: node.getLineno(),
    file: this.file
  });
};

Parsed.prototype.addDoubleDefine = function(name, node) {
  this.doubleDefined.push({
    name: name,
    node: node.toSource(),
    line: node.getLineno(),
    file: this.file
  });
};

Parsed.prototype.toErrors = function() {
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

function enterNewScope(node, scope, parsed, args) {
  var newScope = new Scope(scope);
  args.forEach(function(p) {
    newScope.def(p.getIdentifier(), p, VarType.ARG);
  });
  node.visit(buildHoistingVisitoer(node, newScope, parsed));
  node.visit(buildVisitor(node, newScope, parsed));
  newScope.noRefs().forEach(function([name, node]) {
    parsed.addNoReferenced(name, node);
  });
}

function buildVisitor(rootNode, scope, parsed) {
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
      addReferenced(parsed, node.getLeft(), scope);
      addReferenced(parsed, node.getRight(), scope);
      break;

      // Syntax.ArrayExpression
    case Token.ARRAYLIT:
      for (var e in Iterator(node.getElements())) {
        addReferenced(parsed, e, scope);
      }
      break;

      // Syntax.CallExpression
      // Syntax.NewExpression
    case Token.CALL:
    case Token.NEW:
      addReferenced(parsed, node.getTarget(), scope);
      for (var arg in Iterator(node.getArguments())) {
        addReferenced(parsed, arg, scope);
      }
      break;

      // Syntax.ConditionalExpression
    case Token.HOOK:
      addReferenced(parsed, node.getTestExpression(), scope);
      addReferenced(parsed, node.getTrueExpression(), scope);
      addReferenced(parsed, node.getFalseExpression(), scope);
      break;

    case Token.EXPR_RESULT:
      addReferenced(parsed, node.getExpression(), scope);
      break;

      // Syntax.ExpressionStatement
      // Syntax.SwitchCase
      // Syntax.SwitchStatement
      // Syntax.ThrowStatement
    case Token.CASE:
    case Token.SWITCH:
    case Token.THROW:
      addReferenced(parsed, node.getExpression(), scope);
      break;

      // Syntax.ForInStatement
      // Syntax.ForStatement
    case Token.FOR:
      if (node instanceof org.mozilla.javascript.ast.ForInLoop) {
        addReferenced(parsed, node.getIterator(), scope);
        addReferenced(parsed, node.getIteratedObject(), scope);
      } else {
        addReferenced(parsed, node.getInitializer(), scope);
        addReferenced(parsed, node.getCondition(), scope);
        addReferenced(parsed, node.getIncrement(), scope);
      }
      break;

      // Syntax.DoWhileStatement
      // Syntax.IfStatement
      // Syntax.WhileStatement
    case Token.IF:
    case Token.WHILE:
    case Token.DO:
      addReferenced(parsed, node.getCondition(), scope);
      break;

      // Syntax.LogicalExpression

      // Syntax.Property
    case Token.COLON:
      addReferenced(parsed, node.getRight(), scope);
      break;

      // Syntax.ReturnStatement
    case Token.RETURN:
      addReferenced(parsed, node.getReturnValue(), scope);
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
      addReferenced(parsed, node.getLeft(), scope);
      addReferenced(parsed, node.getRight(), scope);
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
      addReferenced(parsed, node.getOperand(), scope);
      break;

      // Syntax.MemberExpression
    case Token.GETELEM:
      addReferenced(parsed, node.getTarget(), scope);
      addReferenced(parsed, node.getElement(), scope);
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
        addReferenced(parsed, node.getInitializer(), scope);
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
        enterNewScope(node, scope, parsed, args);
        return false;
      }
      break;

    case Token.CATCH:
      if (rootNode !== node) {
        enterNewScope(node, scope, parsed, [node.getVarName()]);
        return false;
      }
      break;

    }
    return true;
  };
}

function buildHoistingVisitoer(rootNode, scope, parsed) {
  return function(node) {
    switch (node.type) {
      // Syntax.VariableDeclarator
    case Token.CONST:
    case Token.VAR:
      if (node instanceof org.mozilla.javascript.ast.VariableInitializer) {
        var identName = node.getTarget().getIdentifier();
        if (scope.isDefThis(identName)) {
          parsed.addDoubleDefine(identName, node);
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
      'arguments', 'this', 'parseInt',

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
  var parsed = new Parsed(file);
  var ast = new org.mozilla.javascript.Parser().parse(source, file, 1);
  var options = defaultOptions();
  if (opt_options) {
    mixin(options, opt_options);
  }
  enterNewScope(ast, null, parsed, options.defaultGlobal.concat(options.global).map(function(name) {
    return new org.mozilla.javascript.ast.Name(-1, name);
  }));
  return parsed;
}

exports.parse = parse;
