var extend = require('./extend')
var allFns = require('./compiled-fns')

function slice (x) {
  return Array.prototype.slice.call(x)
}

function join (x) {
  return slice(x).join('')
}

module.exports = function createEnvironment () {
  // variable id counters
  var $Counter = 0
  var vCounter = 0

  // Linked values are passed from this scope into the generated code block
  // Calling link() passes a value into the generated scope and returns
  // the variable name which it is bound to
  var linkedItems = {}
  function link (value) {
    var name = '$' + $Counter
    var originalName = false
    if(typeof value === 'object' && value.name) {
      name = value.name.replace(/ /g, '_')
      originalName = true
    }

    if (name in linkedItems) return name

    linkedItems[name] = value
    if(!originalName) $Counter++
    return name
  }

  // create a code block
  function block () {
    var code = []
    function push () {
      code.push.apply(code, slice(arguments))
    }

    var vars = []
    function def () {
      var name = 'v' + vCounter
      vCounter++

      vars.push(name)

      if (arguments.length > 0) {
        code.push(name, '=')
        code.push.apply(code, slice(arguments))
        code.push(';')
      }

      return name
    }

    return extend(push, {
      def: def,
      toString: function () {
        return join([
          (vars.length > 0 ? 'var ' + vars.join(',') + ';' : ''),
          join(code)
        ])
      }
    })
  }

  function scope () {
    var entry = block()
    var exit = block()

    var entryToString = entry.toString
    var exitToString = exit.toString

    function save (object, prop) {
      exit(object, prop, '=', entry.def(object, prop), ';')
    }

    return extend(function () {
      entry.apply(entry, slice(arguments))
    }, {
      def: entry.def,
      entry: entry,
      exit: exit,
      save: save,
      set: function (object, prop, value) {
        save(object, prop)
        entry(object, prop, '=', value, ';')
      },
      toString: function () {
        return entryToString() + exitToString()
      }
    })
  }

  function conditional () {
    var pred = join(arguments)
    var thenBlock = scope()
    var elseBlock = scope()

    var thenToString = thenBlock.toString
    var elseToString = elseBlock.toString

    return extend(thenBlock, {
      then: function () {
        thenBlock.apply(thenBlock, slice(arguments))
        return this
      },
      else: function () {
        elseBlock.apply(elseBlock, slice(arguments))
        return this
      },
      toString: function () {
        var elseClause = elseToString()
        if (elseClause) {
          elseClause = 'else{' + elseClause + '}'
        }
        return join([
          'if(', pred, '){',
          thenToString(),
          '}', elseClause
        ])
      }
    })
  }

  // procedure list
  var globalBlock = block()
  var procedures = {}
  function proc (name, count) {
    var args = []
    function arg () {
      var name = 'a' + args.length
      args.push(name)
      return name
    }

    count = count || 0
    for (var i = 0; i < count; ++i) {
      arg()
    }

    var body = scope()
    var bodyToString = body.toString

    var result = procedures[name] = extend(body, {
      arg: arg,
      toString: function () {
        return join([
          'function(', args.join(), '){',
          bodyToString(),
          '}'
        ])
      }
    })

    return result
  }

  function compile () {
    var linkedNames = []
    var linkedValues = []
    Object.keys(linkedItems).sort(function(a, b) {
      var a$ = a.charAt(0) === '$'
      var b$ = b.charAt(0) === '$'
      if(!a$ && !b$) return a.localeCompare(b)
      if(a$ && b$) return +a.slice(1) < +b.slice(1) ? -1 : 1
      if(a$ && !b$) return -1
      return 1
    }).forEach(function (name) {
      var value = linkedItems[name]
      linkedNames.push(name)
      linkedValues.push(value)
    })

    var lastNumber = 0
    for(var q = linkedNames.length - 1; q > -1; q--) {
      if(linkedNames[q].charAt(0) === '$') {
        lastNumber = q
        break
      }
    }

    var key = linkedNames.slice(lastNumber).join()

    var proc = allFns[key]
    if(!proc) {
      throw new Error('missing precompiled function with key: ' + key)
    }
    return proc.apply(null, linkedValues)
  }

  return {
    global: globalBlock,
    link: link,
    block: block,
    proc: proc,
    scope: scope,
    cond: conditional,
    compile: compile
  }
}
