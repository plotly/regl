(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
    typeof define === 'function' && define.amd ? define(factory) :
    (global.createREGL = factory());
}(this, (function () { 'use strict';

function sortedObjectKeys(a) {
  return Object.keys(a).sort()
}

var isTypedArray = function (x) {
  return (
    x instanceof Uint8Array ||
    x instanceof Uint16Array ||
    x instanceof Uint32Array ||
    x instanceof Int8Array ||
    x instanceof Int16Array ||
    x instanceof Int32Array ||
    x instanceof Float32Array ||
    x instanceof Float64Array ||
    x instanceof Uint8ClampedArray
  )
}

var extend = function (base, opts) {
  var keys = sortedObjectKeys(opts)
  for (var i = 0; i < keys.length; ++i) {
    base[keys[i]] = opts[keys[i]]
  }
  return base
}

// Error checking and parameter validation.
//
// Statements for the form `check.someProcedure(...)` get removed by
// a browserify transform for optimized/minified bundles.
//
/* globals atob */
var endl = '\n'

// only used for extracting shader names.  if atob not present, then errors
// will be slightly crappier
function decodeB64 (str) {
  if (typeof atob !== 'undefined') {
    return atob(str)
  }
  return 'base64:' + str
}

function raise (message) {
  var error = new Error('(regl) ' + message)
  console.error(error)
  throw error
}

function check (pred, message) {
  if (!pred) {
    raise(message)
  }
}

function encolon (message) {
  if (message) {
    return ': ' + message
  }
  return ''
}

function checkParameter (param, possibilities, message) {
  if (!(param in possibilities)) {
    raise('unknown parameter (' + param + ')' + encolon(message) +
          '. possible values: ' + sortedObjectKeys(possibilities).join())
  }
}

function checkIsTypedArray (data, message) {
  if (!isTypedArray(data)) {
    raise(
      'invalid parameter type' + encolon(message) +
      '. must be a typed array')
  }
}

function standardTypeEh (value, type) {
  switch (type) {
    case 'number': return typeof value === 'number'
    case 'object': return typeof value === 'object'
    case 'string': return typeof value === 'string'
    case 'boolean': return typeof value === 'boolean'
    case 'function': return typeof value === 'function'
    case 'undefined': return typeof value === 'undefined'
    case 'symbol': return typeof value === 'symbol'
  }
}

function checkTypeOf (value, type, message) {
  if (!standardTypeEh(value, type)) {
    raise(
      'invalid parameter type' + encolon(message) +
      '. expected ' + type + ', got ' + (typeof value))
  }
}

function checkNonNegativeInt (value, message) {
  if (!((value >= 0) &&
        ((value | 0) === value))) {
    raise('invalid parameter type, (' + value + ')' + encolon(message) +
          '. must be a nonnegative integer')
  }
}

function checkOneOf (value, list, message) {
  if (list.indexOf(value) < 0) {
    raise('invalid value' + encolon(message) + '. must be one of: ' + list)
  }
}

var constructorKeys = [
  'gl',
  'canvas',
  'container',
  'attributes',
  'pixelRatio',
  'extensions',
  'optionalExtensions',
  'profile',
  'onDone'
]

function checkConstructor (obj) {
  sortedObjectKeys(obj).forEach(function (key) {
    if (constructorKeys.indexOf(key) < 0) {
      raise('invalid regl constructor argument "' + key + '". must be one of ' + constructorKeys)
    }
  })
}

function leftPad (str, n) {
  str = str + ''
  while (str.length < n) {
    str = ' ' + str
  }
  return str
}

function ShaderFile () {
  this.name = 'unknown'
  this.lines = []
  this.index = {}
  this.hasErrors = false
}

function ShaderLine (number, line) {
  this.number = number
  this.line = line
  this.errors = []
}

function ShaderError (fileNumber, lineNumber, message) {
  this.file = fileNumber
  this.line = lineNumber
  this.message = message
}

function guessCommand () {
  var error = new Error()
  var stack = (error.stack || error).toString()
  var pat = /compileProcedure.*\n\s*at.*\((.*)\)/.exec(stack)
  if (pat) {
    return pat[1]
  }
  var pat2 = /compileProcedure.*\n\s*at\s+(.*)(\n|$)/.exec(stack)
  if (pat2) {
    return pat2[1]
  }
  return 'unknown'
}

function guessCallSite () {
  var error = new Error()
  var stack = (error.stack || error).toString()
  var pat = /at REGLCommand.*\n\s+at.*\((.*)\)/.exec(stack)
  if (pat) {
    return pat[1]
  }
  var pat2 = /at REGLCommand.*\n\s+at\s+(.*)\n/.exec(stack)
  if (pat2) {
    return pat2[1]
  }
  return 'unknown'
}

function parseSource (source, command) {
  var lines = source.split('\n')
  var lineNumber = 1
  var fileNumber = 0
  var files = {
    unknown: new ShaderFile(),
    0: new ShaderFile()
  }
  files.unknown.name = files[0].name = command || guessCommand()
  files.unknown.lines.push(new ShaderLine(0, ''))
  for (var i = 0; i < lines.length; ++i) {
    var line = lines[i]
    var parts = /^\s*#\s*(\w+)\s+(.+)\s*$/.exec(line)
    if (parts) {
      switch (parts[1]) {
        case 'line':
          var lineNumberInfo = /(\d+)(\s+\d+)?/.exec(parts[2])
          if (lineNumberInfo) {
            lineNumber = lineNumberInfo[1] | 0
            if (lineNumberInfo[2]) {
              fileNumber = lineNumberInfo[2] | 0
              if (!(fileNumber in files)) {
                files[fileNumber] = new ShaderFile()
              }
            }
          }
          break
        case 'define':
          var nameInfo = /SHADER_NAME(_B64)?\s+(.*)$/.exec(parts[2])
          if (nameInfo) {
            files[fileNumber].name = (nameInfo[1]
              ? decodeB64(nameInfo[2])
              : nameInfo[2])
          }
          break
      }
    }
    files[fileNumber].lines.push(new ShaderLine(lineNumber++, line))
  }
  sortedObjectKeys(files).forEach(function (fileNumber) {
    var file = files[fileNumber]
    file.lines.forEach(function (line) {
      file.index[line.number] = line
    })
  })
  return files
}

function parseErrorLog (errLog) {
  var result = []
  errLog.split('\n').forEach(function (errMsg) {
    if (errMsg.length < 5) {
      return
    }
    var parts = /^ERROR:\s+(\d+):(\d+):\s*(.*)$/.exec(errMsg)
    if (parts) {
      result.push(new ShaderError(
        parts[1] | 0,
        parts[2] | 0,
        parts[3].trim()))
    } else if (errMsg.length > 0) {
      result.push(new ShaderError('unknown', 0, errMsg))
    }
  })
  return result
}

function annotateFiles (files, errors) {
  errors.forEach(function (error) {
    var file = files[error.file]
    if (file) {
      var line = file.index[error.line]
      if (line) {
        line.errors.push(error)
        file.hasErrors = true
        return
      }
    }
    files.unknown.hasErrors = true
    files.unknown.lines[0].errors.push(error)
  })
}

function checkShaderError (gl, shader, source, type, command) {
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    var errLog = gl.getShaderInfoLog(shader)
    var typeName = type === gl.FRAGMENT_SHADER ? 'fragment' : 'vertex'
    checkCommandType(source, 'string', typeName + ' shader source must be a string', command)
    var files = parseSource(source, command)
    var errors = parseErrorLog(errLog)
    annotateFiles(files, errors)

    sortedObjectKeys(files).forEach(function (fileNumber) {
      var file = files[fileNumber]
      if (!file.hasErrors) {
        return
      }

      var strings = ['']
      var styles = ['']

      function push (str, style) {
        strings.push(str)
        styles.push(style || '')
      }

      push('file number ' + fileNumber + ': ' + file.name + '\n', 'color:red;text-decoration:underline;font-weight:bold')

      file.lines.forEach(function (line) {
        if (line.errors.length > 0) {
          push(leftPad(line.number, 4) + '|  ', 'background-color:yellow; font-weight:bold')
          push(line.line + endl, 'color:red; background-color:yellow; font-weight:bold')

          // try to guess token
          var offset = 0
          line.errors.forEach(function (error) {
            var message = error.message
            var token = /^\s*'(.*)'\s*:\s*(.*)$/.exec(message)
            if (token) {
              var tokenPat = token[1]
              message = token[2]
              switch (tokenPat) {
                case 'assign':
                  tokenPat = '='
                  break
              }
              offset = Math.max(line.line.indexOf(tokenPat, offset), 0)
            } else {
              offset = 0
            }

            push(leftPad('| ', 6))
            push(leftPad('^^^', offset + 3) + endl, 'font-weight:bold')
            push(leftPad('| ', 6))
            push(message + endl, 'font-weight:bold')
          })
          push(leftPad('| ', 6) + endl)
        } else {
          push(leftPad(line.number, 4) + '|  ')
          push(line.line + endl, 'color:red')
        }
      })
      if (typeof document !== 'undefined' && !window.chrome) {
        styles[0] = strings.join('%c')
        console.log.apply(console, styles)
      } else {
        console.log(strings.join(''))
      }
    })

    check.raise('Error compiling ' + typeName + ' shader, ' + files[0].name)
  }
}

function checkLinkError (gl, program, fragShader, vertShader, command) {
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    var errLog = gl.getProgramInfoLog(program)
    var fragParse = parseSource(fragShader, command)
    var vertParse = parseSource(vertShader, command)

    var header = 'Error linking program with vertex shader, "' +
      vertParse[0].name + '", and fragment shader "' + fragParse[0].name + '"'

    if (typeof document !== 'undefined') {
      console.log('%c' + header + endl + '%c' + errLog,
        'color:red;text-decoration:underline;font-weight:bold',
        'color:red')
    } else {
      console.log(header + endl + errLog)
    }
    check.raise(header)
  }
}

function saveCommandRef (object) {
  object._commandRef = guessCommand()
}

function saveDrawCommandInfo (opts, uniforms, attributes, stringStore) {
  saveCommandRef(opts)

  function id (str) {
    if (str) {
      return stringStore.id(str)
    }
    return 0
  }
  opts._fragId = id(opts.static.frag)
  opts._vertId = id(opts.static.vert)

  function addProps (dict, set) {
    sortedObjectKeys(set).forEach(function (u) {
      dict[stringStore.id(u)] = true
    })
  }

  var uniformSet = opts._uniformSet = {}
  addProps(uniformSet, uniforms.static)
  addProps(uniformSet, uniforms.dynamic)

  var attributeSet = opts._attributeSet = {}
  addProps(attributeSet, attributes.static)
  addProps(attributeSet, attributes.dynamic)

  opts._hasCount = (
    'count' in opts.static ||
    'count' in opts.dynamic ||
    'elements' in opts.static ||
    'elements' in opts.dynamic)
}

function commandRaise (message, command) {
  var callSite = guessCallSite()
  raise(message +
    ' in command ' + (command || guessCommand()) +
    (callSite === 'unknown' ? '' : ' called from ' + callSite))
}

function checkCommand (pred, message, command) {
  if (!pred) {
    commandRaise(message, command || guessCommand())
  }
}

function checkParameterCommand (param, possibilities, message, command) {
  if (!(param in possibilities)) {
    commandRaise(
      'unknown parameter (' + param + ')' + encolon(message) +
      '. possible values: ' + sortedObjectKeys(possibilities).join(),
      command || guessCommand())
  }
}

function checkCommandType (value, type, message, command) {
  if (!standardTypeEh(value, type)) {
    commandRaise(
      'invalid parameter type' + encolon(message) +
      '. expected ' + type + ', got ' + (typeof value),
      command || guessCommand())
  }
}

function checkOptional (block) {
  block()
}

function checkFramebufferFormat (attachment, texFormats, rbFormats) {
  if (attachment.texture) {
    checkOneOf(
      attachment.texture._texture.internalformat,
      texFormats,
      'unsupported texture format for attachment')
  } else {
    checkOneOf(
      attachment.renderbuffer._renderbuffer.format,
      rbFormats,
      'unsupported renderbuffer format for attachment')
  }
}

var GL_CLAMP_TO_EDGE = 0x812F

var GL_NEAREST = 0x2600
var GL_NEAREST_MIPMAP_NEAREST = 0x2700
var GL_LINEAR_MIPMAP_NEAREST = 0x2701
var GL_NEAREST_MIPMAP_LINEAR = 0x2702
var GL_LINEAR_MIPMAP_LINEAR = 0x2703

var GL_BYTE = 5120
var GL_UNSIGNED_BYTE = 5121
var GL_SHORT = 5122
var GL_UNSIGNED_SHORT = 5123
var GL_INT = 5124
var GL_UNSIGNED_INT = 5125
var GL_FLOAT = 5126

var GL_UNSIGNED_SHORT_4_4_4_4 = 0x8033
var GL_UNSIGNED_SHORT_5_5_5_1 = 0x8034
var GL_UNSIGNED_SHORT_5_6_5 = 0x8363
var GL_UNSIGNED_INT_24_8_WEBGL = 0x84FA

var GL_HALF_FLOAT_OES = 0x8D61

var TYPE_SIZE = {}

TYPE_SIZE[GL_BYTE] =
TYPE_SIZE[GL_UNSIGNED_BYTE] = 1

TYPE_SIZE[GL_SHORT] =
TYPE_SIZE[GL_UNSIGNED_SHORT] =
TYPE_SIZE[GL_HALF_FLOAT_OES] =
TYPE_SIZE[GL_UNSIGNED_SHORT_5_6_5] =
TYPE_SIZE[GL_UNSIGNED_SHORT_4_4_4_4] =
TYPE_SIZE[GL_UNSIGNED_SHORT_5_5_5_1] = 2

TYPE_SIZE[GL_INT] =
TYPE_SIZE[GL_UNSIGNED_INT] =
TYPE_SIZE[GL_FLOAT] =
TYPE_SIZE[GL_UNSIGNED_INT_24_8_WEBGL] = 4

function pixelSize (type, channels) {
  if (type === GL_UNSIGNED_SHORT_5_5_5_1 ||
      type === GL_UNSIGNED_SHORT_4_4_4_4 ||
      type === GL_UNSIGNED_SHORT_5_6_5) {
    return 2
  } else if (type === GL_UNSIGNED_INT_24_8_WEBGL) {
    return 4
  } else {
    return TYPE_SIZE[type] * channels
  }
}

function isPow2 (v) {
  return !(v & (v - 1)) && (!!v)
}

function checkTexture2D (info, mipData, limits) {
  var i
  var w = mipData.width
  var h = mipData.height
  var c = mipData.channels

  // Check texture shape
  check(w > 0 && w <= limits.maxTextureSize &&
        h > 0 && h <= limits.maxTextureSize,
  'invalid texture shape')

  // check wrap mode
  if (info.wrapS !== GL_CLAMP_TO_EDGE || info.wrapT !== GL_CLAMP_TO_EDGE) {
    check(isPow2(w) && isPow2(h),
      'incompatible wrap mode for texture, both width and height must be power of 2')
  }

  if (mipData.mipmask === 1) {
    if (w !== 1 && h !== 1) {
      check(
        info.minFilter !== GL_NEAREST_MIPMAP_NEAREST &&
        info.minFilter !== GL_NEAREST_MIPMAP_LINEAR &&
        info.minFilter !== GL_LINEAR_MIPMAP_NEAREST &&
        info.minFilter !== GL_LINEAR_MIPMAP_LINEAR,
        'min filter requires mipmap')
    }
  } else {
    // texture must be power of 2
    check(isPow2(w) && isPow2(h),
      'texture must be a square power of 2 to support mipmapping')
    check(mipData.mipmask === (w << 1) - 1,
      'missing or incomplete mipmap data')
  }

  if (mipData.type === GL_FLOAT) {
    if (limits.extensions.indexOf('oes_texture_float_linear') < 0) {
      check(info.minFilter === GL_NEAREST && info.magFilter === GL_NEAREST,
        'filter not supported, must enable oes_texture_float_linear')
    }
    check(!info.genMipmaps,
      'mipmap generation not supported with float textures')
  }

  // check image complete
  var mipimages = mipData.images
  for (i = 0; i < 16; ++i) {
    if (mipimages[i]) {
      var mw = w >> i
      var mh = h >> i
      check(mipData.mipmask & (1 << i), 'missing mipmap data')

      var img = mipimages[i]

      check(
        img.width === mw &&
        img.height === mh,
        'invalid shape for mip images')

      check(
        img.format === mipData.format &&
        img.internalformat === mipData.internalformat &&
        img.type === mipData.type,
        'incompatible type for mip image')

      if (img.compressed) {
        // TODO: check size for compressed images
      } else if (img.data) {
        // check(img.data.byteLength === mw * mh *
        // Math.max(pixelSize(img.type, c), img.unpackAlignment),
        var rowSize = Math.ceil(pixelSize(img.type, c) * mw / img.unpackAlignment) * img.unpackAlignment
        check(img.data.byteLength === rowSize * mh,
          'invalid data for image, buffer size is inconsistent with image format')
      } else if (img.element) {
        // TODO: check element can be loaded
      } else if (img.copy) {
        // TODO: check compatible format and type
      }
    } else if (!info.genMipmaps) {
      check((mipData.mipmask & (1 << i)) === 0, 'extra mipmap data')
    }
  }

  if (mipData.compressed) {
    check(!info.genMipmaps,
      'mipmap generation for compressed images not supported')
  }
}

function checkTextureCube (texture, info, faces, limits) {
  var w = texture.width
  var h = texture.height
  var c = texture.channels

  // Check texture shape
  check(
    w > 0 && w <= limits.maxTextureSize && h > 0 && h <= limits.maxTextureSize,
    'invalid texture shape')
  check(
    w === h,
    'cube map must be square')
  check(
    info.wrapS === GL_CLAMP_TO_EDGE && info.wrapT === GL_CLAMP_TO_EDGE,
    'wrap mode not supported by cube map')

  for (var i = 0; i < faces.length; ++i) {
    var face = faces[i]
    check(
      face.width === w && face.height === h,
      'inconsistent cube map face shape')

    if (info.genMipmaps) {
      check(!face.compressed,
        'can not generate mipmap for compressed textures')
      check(face.mipmask === 1,
        'can not specify mipmaps and generate mipmaps')
    } else {
      // TODO: check mip and filter mode
    }

    var mipmaps = face.images
    for (var j = 0; j < 16; ++j) {
      var img = mipmaps[j]
      if (img) {
        var mw = w >> j
        var mh = h >> j
        check(face.mipmask & (1 << j), 'missing mipmap data')
        check(
          img.width === mw &&
          img.height === mh,
          'invalid shape for mip images')
        check(
          img.format === texture.format &&
          img.internalformat === texture.internalformat &&
          img.type === texture.type,
          'incompatible type for mip image')

        if (img.compressed) {
          // TODO: check size for compressed images
        } else if (img.data) {
          check(img.data.byteLength === mw * mh *
            Math.max(pixelSize(img.type, c), img.unpackAlignment),
          'invalid data for image, buffer size is inconsistent with image format')
        } else if (img.element) {
          // TODO: check element can be loaded
        } else if (img.copy) {
          // TODO: check compatible format and type
        }
      }
    }
  }
}

var check$1 = extend(check, {
  optional: checkOptional,
  raise: raise,
  commandRaise: commandRaise,
  command: checkCommand,
  parameter: checkParameter,
  commandParameter: checkParameterCommand,
  constructor: checkConstructor,
  type: checkTypeOf,
  commandType: checkCommandType,
  isTypedArray: checkIsTypedArray,
  nni: checkNonNegativeInt,
  oneOf: checkOneOf,
  shaderError: checkShaderError,
  linkError: checkLinkError,
  callSite: guessCallSite,
  saveCommandRef: saveCommandRef,
  saveDrawInfo: saveDrawCommandInfo,
  framebufferFormat: checkFramebufferFormat,
  guessCommand: guessCommand,
  texture2D: checkTexture2D,
  textureCube: checkTextureCube
});

var VARIABLE_COUNTER = 0

var DYN_FUNC = 0
var DYN_CONSTANT = 5
var DYN_ARRAY = 6

function DynamicVariable (type, data) {
  this.id = (VARIABLE_COUNTER++)
  this.type = type
  this.data = data
}

function escapeStr (str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function splitParts (str) {
  if (str.length === 0) {
    return []
  }

  var firstChar = str.charAt(0)
  var lastChar = str.charAt(str.length - 1)

  if (str.length > 1 &&
      firstChar === lastChar &&
      (firstChar === '"' || firstChar === "'")) {
    return ['"' + escapeStr(str.substr(1, str.length - 2)) + '"']
  }

  var parts = /\[(false|true|null|\d+|'[^']*'|"[^"]*")\]/.exec(str)
  if (parts) {
    return (
      splitParts(str.substr(0, parts.index))
        .concat(splitParts(parts[1]))
        .concat(splitParts(str.substr(parts.index + parts[0].length)))
    )
  }

  var subparts = str.split('.')
  if (subparts.length === 1) {
    return ['"' + escapeStr(str) + '"']
  }

  var result = []
  for (var i = 0; i < subparts.length; ++i) {
    result = result.concat(splitParts(subparts[i]))
  }
  return result
}

function toAccessorString (str) {
  return '[' + splitParts(str).join('][') + ']'
}

function defineDynamic (type, data) {
  return new DynamicVariable(type, toAccessorString(data + ''))
}

function isDynamic (x) {
  return (typeof x === 'function' && !x._reglType) || (x instanceof DynamicVariable)
}

function unbox (x, path) {
  if (typeof x === 'function') {
    return new DynamicVariable(DYN_FUNC, x)
  } else if (typeof x === 'number' || typeof x === 'boolean') {
    return new DynamicVariable(DYN_CONSTANT, x)
  } else if (Array.isArray(x)) {
    return new DynamicVariable(DYN_ARRAY, x.map(function (y, i) { return unbox(y, path + '[' + i + ']') }))
  } else if (x instanceof DynamicVariable) {
    return x
  }
  check$1(false, 'invalid option type in uniform ' + path)
}

var dynamic = {
  DynamicVariable: DynamicVariable,
  define: defineDynamic,
  isDynamic: isDynamic,
  unbox: unbox,
  accessor: toAccessorString
};

/* globals requestAnimationFrame, cancelAnimationFrame */
var raf = {
  next: typeof requestAnimationFrame === 'function'
    ? function (cb) { return requestAnimationFrame(cb) }
    : function (cb) { return setTimeout(cb, 16) },
  cancel: typeof cancelAnimationFrame === 'function'
    ? function (raf) { return cancelAnimationFrame(raf) }
    : clearTimeout
};

/* globals performance */
var clock = (typeof performance !== 'undefined' && performance.now)
    ? function () { return performance.now() }
    : function () { return +(new Date()) };

function createStringStore () {
  var stringIds = { '': 0 }
  var stringValues = ['']
  return {
    id: function (str) {
      var result = stringIds[str]
      if (result) {
        return result
      }
      result = stringIds[str] = stringValues.length
      stringValues.push(str)
      return result
    },

    str: function (id) {
      return stringValues[id]
    }
  }
}

// Context and canvas creation helper functions
function createCanvas (element, onDone, pixelRatio) {
  var canvas = document.createElement('canvas')
  extend(canvas.style, {
    border: 0,
    margin: 0,
    padding: 0,
    top: 0,
    left: 0,
    width: '100%',
    height: '100%'
  })
  element.appendChild(canvas)

  if (element === document.body) {
    canvas.style.position = 'absolute'
    extend(element.style, {
      margin: 0,
      padding: 0
    })
  }

  function resize () {
    var w = window.innerWidth
    var h = window.innerHeight
    if (element !== document.body) {
      var bounds = canvas.getBoundingClientRect()
      w = bounds.right - bounds.left
      h = bounds.bottom - bounds.top
    }
    canvas.width = pixelRatio * w
    canvas.height = pixelRatio * h
  }

  var resizeObserver
  if (element !== document.body && typeof ResizeObserver === 'function') {
    // ignore 'ResizeObserver' is not defined
    // eslint-disable-next-line
    resizeObserver = new ResizeObserver(function () {
      // setTimeout to avoid flicker
      setTimeout(resize)
    })
    resizeObserver.observe(element)
  } else {
    window.addEventListener('resize', resize, false)
  }

  function onDestroy () {
    if (resizeObserver) {
      resizeObserver.disconnect()
    } else {
      window.removeEventListener('resize', resize)
    }
    element.removeChild(canvas)
  }

  resize()

  return {
    canvas: canvas,
    onDestroy: onDestroy
  }
}

function createContext (canvas, contextAttributes) {
  function get (name) {
    try {
      return canvas.getContext(name, contextAttributes)
    } catch (e) {
      return null
    }
  }
  return (
    get('webgl') ||
    get('experimental-webgl') ||
    get('webgl-experimental')
  )
}

function isHTMLElement (obj) {
  return (
    typeof obj.nodeName === 'string' &&
    typeof obj.appendChild === 'function' &&
    typeof obj.getBoundingClientRect === 'function'
  )
}

function isWebGLContext (obj) {
  return (
    typeof obj.drawArrays === 'function' ||
    typeof obj.drawElements === 'function'
  )
}

function parseExtensions (input) {
  if (typeof input === 'string') {
    return input.split()
  }
  check$1(Array.isArray(input), 'invalid extension array')
  return input
}

function getElement (desc) {
  if (typeof desc === 'string') {
    check$1(typeof document !== 'undefined', 'not supported outside of DOM')
    return document.querySelector(desc)
  }
  return desc
}

function parseArgs (args_) {
  var args = args_ || {}
  var element, container, canvas, gl
  var contextAttributes = {}
  var extensions = []
  var optionalExtensions = []
  var pixelRatio = (typeof window === 'undefined' ? 1 : window.devicePixelRatio)
  var profile = false
  var onDone = function (err) {
    if (err) {
      check$1.raise(err)
    }
  }
  var onDestroy = function () {}
  if (typeof args === 'string') {
    check$1(
      typeof document !== 'undefined',
      'selector queries only supported in DOM environments')
    element = document.querySelector(args)
    check$1(element, 'invalid query string for element')
  } else if (typeof args === 'object') {
    if (isHTMLElement(args)) {
      element = args
    } else if (isWebGLContext(args)) {
      gl = args
      canvas = gl.canvas
    } else {
      check$1.constructor(args)
      if ('gl' in args) {
        gl = args.gl
      } else if ('canvas' in args) {
        canvas = getElement(args.canvas)
      } else if ('container' in args) {
        container = getElement(args.container)
      }
      if ('attributes' in args) {
        contextAttributes = args.attributes
        check$1.type(contextAttributes, 'object', 'invalid context attributes')
      }
      if ('extensions' in args) {
        extensions = parseExtensions(args.extensions)
      }
      if ('optionalExtensions' in args) {
        optionalExtensions = parseExtensions(args.optionalExtensions)
      }
      if ('onDone' in args) {
        check$1.type(
          args.onDone, 'function',
          'invalid or missing onDone callback')
        onDone = args.onDone
      }
      if ('profile' in args) {
        profile = !!args.profile
      }
      if ('pixelRatio' in args) {
        pixelRatio = +args.pixelRatio
        check$1(pixelRatio > 0, 'invalid pixel ratio')
      }
    }
  } else {
    check$1.raise('invalid arguments to regl')
  }

  if (element) {
    if (element.nodeName.toLowerCase() === 'canvas') {
      canvas = element
    } else {
      container = element
    }
  }

  if (!gl) {
    if (!canvas) {
      check$1(
        typeof document !== 'undefined',
        'must manually specify webgl context outside of DOM environments')
      var result = createCanvas(container || document.body, onDone, pixelRatio)
      if (!result) {
        return null
      }
      canvas = result.canvas
      onDestroy = result.onDestroy
    }
    // workaround for chromium bug, premultiplied alpha value is platform dependent
    if (contextAttributes.premultipliedAlpha === undefined) contextAttributes.premultipliedAlpha = true
    gl = createContext(canvas, contextAttributes)
  }

  if (!gl) {
    onDestroy()
    onDone('webgl not supported, try upgrading your browser or graphics drivers http://get.webgl.org')
    return null
  }

  return {
    gl: gl,
    canvas: canvas,
    container: container,
    extensions: extensions,
    optionalExtensions: optionalExtensions,
    pixelRatio: pixelRatio,
    profile: profile,
    onDone: onDone,
    onDestroy: onDestroy
  }
}

function createExtensionCache (gl, config) {
  var extensions = {}

  function tryLoadExtension (name_) {
    check$1.type(name_, 'string', 'extension name must be string')
    var name = name_.toLowerCase()
    var ext
    try {
      ext = extensions[name] = gl.getExtension(name)
    } catch (e) {}
    return !!ext
  }

  for (var i = 0; i < config.extensions.length; ++i) {
    var name = config.extensions[i]
    if (!tryLoadExtension(name)) {
      config.onDestroy()
      config.onDone('"' + name + '" extension is not supported by the current WebGL context, try upgrading your system or a different browser')
      return null
    }
  }

  config.optionalExtensions.forEach(tryLoadExtension)

  return {
    extensions: extensions,
    restore: function () {
      sortedObjectKeys(extensions).forEach(function (name) {
        if (extensions[name] && !tryLoadExtension(name)) {
          throw new Error('(regl): error restoring extension ' + name)
        }
      })
    }
  }
}

function loop (n, f) {
  var result = Array(n)
  for (var i = 0; i < n; ++i) {
    result[i] = f(i)
  }
  return result
}

var GL_BYTE$1 = 5120
var GL_UNSIGNED_BYTE$2 = 5121
var GL_SHORT$1 = 5122
var GL_UNSIGNED_SHORT$1 = 5123
var GL_INT$1 = 5124
var GL_UNSIGNED_INT$1 = 5125
var GL_FLOAT$2 = 5126

function nextPow16 (v) {
  for (var i = 16; i <= (1 << 28); i *= 16) {
    if (v <= i) {
      return i
    }
  }
  return 0
}

function log2 (v) {
  var r, shift
  r = (v > 0xFFFF) << 4
  v >>>= r
  shift = (v > 0xFF) << 3
  v >>>= shift; r |= shift
  shift = (v > 0xF) << 2
  v >>>= shift; r |= shift
  shift = (v > 0x3) << 1
  v >>>= shift; r |= shift
  return r | (v >> 1)
}

function createPool () {
  var bufferPool = loop(8, function () {
    return []
  })

  function alloc (n) {
    var sz = nextPow16(n)
    var bin = bufferPool[log2(sz) >> 2]
    if (bin.length > 0) {
      return bin.pop()
    }
    return new ArrayBuffer(sz)
  }

  function free (buf) {
    bufferPool[log2(buf.byteLength) >> 2].push(buf)
  }

  function allocType (type, n) {
    var result = null
    switch (type) {
      case GL_BYTE$1:
        result = new Int8Array(alloc(n), 0, n)
        break
      case GL_UNSIGNED_BYTE$2:
        result = new Uint8Array(alloc(n), 0, n)
        break
      case GL_SHORT$1:
        result = new Int16Array(alloc(2 * n), 0, n)
        break
      case GL_UNSIGNED_SHORT$1:
        result = new Uint16Array(alloc(2 * n), 0, n)
        break
      case GL_INT$1:
        result = new Int32Array(alloc(4 * n), 0, n)
        break
      case GL_UNSIGNED_INT$1:
        result = new Uint32Array(alloc(4 * n), 0, n)
        break
      case GL_FLOAT$2:
        result = new Float32Array(alloc(4 * n), 0, n)
        break
      default:
        return null
    }
    if (result.length !== n) {
      return result.subarray(0, n)
    }
    return result
  }

  function freeType (array) {
    free(array.buffer)
  }

  return {
    alloc: alloc,
    free: free,
    allocType: allocType,
    freeType: freeType
  }
}

var pool = createPool()

// zero pool for initial zero data
pool.zero = createPool()

var GL_SUBPIXEL_BITS = 0x0D50
var GL_RED_BITS = 0x0D52
var GL_GREEN_BITS = 0x0D53
var GL_BLUE_BITS = 0x0D54
var GL_ALPHA_BITS = 0x0D55
var GL_DEPTH_BITS = 0x0D56
var GL_STENCIL_BITS = 0x0D57

var GL_ALIASED_POINT_SIZE_RANGE = 0x846D
var GL_ALIASED_LINE_WIDTH_RANGE = 0x846E

var GL_MAX_TEXTURE_SIZE = 0x0D33
var GL_MAX_VIEWPORT_DIMS = 0x0D3A
var GL_MAX_VERTEX_ATTRIBS = 0x8869
var GL_MAX_VERTEX_UNIFORM_VECTORS = 0x8DFB
var GL_MAX_VARYING_VECTORS = 0x8DFC
var GL_MAX_COMBINED_TEXTURE_IMAGE_UNITS = 0x8B4D
var GL_MAX_VERTEX_TEXTURE_IMAGE_UNITS = 0x8B4C
var GL_MAX_TEXTURE_IMAGE_UNITS = 0x8872
var GL_MAX_FRAGMENT_UNIFORM_VECTORS = 0x8DFD
var GL_MAX_CUBE_MAP_TEXTURE_SIZE = 0x851C
var GL_MAX_RENDERBUFFER_SIZE = 0x84E8

var GL_VENDOR = 0x1F00
var GL_RENDERER = 0x1F01
var GL_VERSION = 0x1F02
var GL_SHADING_LANGUAGE_VERSION = 0x8B8C

var GL_MAX_TEXTURE_MAX_ANISOTROPY_EXT = 0x84FF

var GL_MAX_COLOR_ATTACHMENTS_WEBGL = 0x8CDF
var GL_MAX_DRAW_BUFFERS_WEBGL = 0x8824

var GL_TEXTURE_2D = 0x0DE1
var GL_TEXTURE_CUBE_MAP = 0x8513
var GL_TEXTURE_CUBE_MAP_POSITIVE_X = 0x8515
var GL_TEXTURE0 = 0x84C0
var GL_RGBA = 0x1908
var GL_FLOAT$1 = 0x1406
var GL_UNSIGNED_BYTE$1 = 0x1401
var GL_FRAMEBUFFER = 0x8D40
var GL_FRAMEBUFFER_COMPLETE = 0x8CD5
var GL_COLOR_ATTACHMENT0 = 0x8CE0
var GL_COLOR_BUFFER_BIT$1 = 0x4000

var wrapLimits = function (gl, extensions) {
  var maxAnisotropic = 1
  if (extensions.ext_texture_filter_anisotropic) {
    maxAnisotropic = gl.getParameter(GL_MAX_TEXTURE_MAX_ANISOTROPY_EXT)
  }

  var maxDrawbuffers = 1
  var maxColorAttachments = 1
  if (extensions.webgl_draw_buffers) {
    maxDrawbuffers = gl.getParameter(GL_MAX_DRAW_BUFFERS_WEBGL)
    maxColorAttachments = gl.getParameter(GL_MAX_COLOR_ATTACHMENTS_WEBGL)
  }

  // detect if reading float textures is available (Safari doesn't support)
  var readFloat = !!extensions.oes_texture_float
  if (readFloat) {
    var readFloatTexture = gl.createTexture()
    gl.bindTexture(GL_TEXTURE_2D, readFloatTexture)
    gl.texImage2D(GL_TEXTURE_2D, 0, GL_RGBA, 1, 1, 0, GL_RGBA, GL_FLOAT$1, null)

    var fbo = gl.createFramebuffer()
    gl.bindFramebuffer(GL_FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, readFloatTexture, 0)
    gl.bindTexture(GL_TEXTURE_2D, null)

    if (gl.checkFramebufferStatus(GL_FRAMEBUFFER) !== GL_FRAMEBUFFER_COMPLETE) readFloat = false

    else {
      gl.viewport(0, 0, 1, 1)
      gl.clearColor(1.0, 0.0, 0.0, 1.0)
      gl.clear(GL_COLOR_BUFFER_BIT$1)
      var pixels = pool.allocType(GL_FLOAT$1, 4)
      gl.readPixels(0, 0, 1, 1, GL_RGBA, GL_FLOAT$1, pixels)

      if (gl.getError()) readFloat = false
      else {
        gl.deleteFramebuffer(fbo)
        gl.deleteTexture(readFloatTexture)

        readFloat = pixels[0] === 1.0
      }

      pool.freeType(pixels)
    }
  }

  // detect non power of two cube textures support (IE doesn't support)
  var isIE = typeof navigator !== 'undefined' && (/MSIE/.test(navigator.userAgent) || /Trident\//.test(navigator.appVersion) || /Edge/.test(navigator.userAgent))

  var npotTextureCube = true

  if (!isIE) {
    var cubeTexture = gl.createTexture()
    var data = pool.allocType(GL_UNSIGNED_BYTE$1, 36)
    gl.activeTexture(GL_TEXTURE0)
    gl.bindTexture(GL_TEXTURE_CUBE_MAP, cubeTexture)
    gl.texImage2D(GL_TEXTURE_CUBE_MAP_POSITIVE_X, 0, GL_RGBA, 3, 3, 0, GL_RGBA, GL_UNSIGNED_BYTE$1, data)
    pool.freeType(data)
    gl.bindTexture(GL_TEXTURE_CUBE_MAP, null)
    gl.deleteTexture(cubeTexture)
    npotTextureCube = !gl.getError()
  }

  return {
    // drawing buffer bit depth
    colorBits: [
      gl.getParameter(GL_RED_BITS),
      gl.getParameter(GL_GREEN_BITS),
      gl.getParameter(GL_BLUE_BITS),
      gl.getParameter(GL_ALPHA_BITS)
    ],
    depthBits: gl.getParameter(GL_DEPTH_BITS),
    stencilBits: gl.getParameter(GL_STENCIL_BITS),
    subpixelBits: gl.getParameter(GL_SUBPIXEL_BITS),

    // supported extensions
    extensions: sortedObjectKeys(extensions).filter(function (ext) {
      return !!extensions[ext]
    }),

    // max aniso samples
    maxAnisotropic: maxAnisotropic,

    // max draw buffers
    maxDrawbuffers: maxDrawbuffers,
    maxColorAttachments: maxColorAttachments,

    // point and line size ranges
    pointSizeDims: gl.getParameter(GL_ALIASED_POINT_SIZE_RANGE),
    lineWidthDims: gl.getParameter(GL_ALIASED_LINE_WIDTH_RANGE),
    maxViewportDims: gl.getParameter(GL_MAX_VIEWPORT_DIMS),
    maxCombinedTextureUnits: gl.getParameter(GL_MAX_COMBINED_TEXTURE_IMAGE_UNITS),
    maxCubeMapSize: gl.getParameter(GL_MAX_CUBE_MAP_TEXTURE_SIZE),
    maxRenderbufferSize: gl.getParameter(GL_MAX_RENDERBUFFER_SIZE),
    maxTextureUnits: gl.getParameter(GL_MAX_TEXTURE_IMAGE_UNITS),
    maxTextureSize: gl.getParameter(GL_MAX_TEXTURE_SIZE),
    maxAttributes: gl.getParameter(GL_MAX_VERTEX_ATTRIBS),
    maxVertexUniforms: gl.getParameter(GL_MAX_VERTEX_UNIFORM_VECTORS),
    maxVertexTextureUnits: gl.getParameter(GL_MAX_VERTEX_TEXTURE_IMAGE_UNITS),
    maxVaryingVectors: gl.getParameter(GL_MAX_VARYING_VECTORS),
    maxFragmentUniforms: gl.getParameter(GL_MAX_FRAGMENT_UNIFORM_VECTORS),

    // vendor info
    glsl: gl.getParameter(GL_SHADING_LANGUAGE_VERSION),
    renderer: gl.getParameter(GL_RENDERER),
    vendor: gl.getParameter(GL_VENDOR),
    version: gl.getParameter(GL_VERSION),

    // quirks
    readFloat: readFloat,
    npotTextureCube: npotTextureCube
  }
}

function isNDArrayLike (obj) {
  return (
    !!obj &&
    typeof obj === 'object' &&
    Array.isArray(obj.shape) &&
    Array.isArray(obj.stride) &&
    typeof obj.offset === 'number' &&
    obj.shape.length === obj.stride.length &&
    (Array.isArray(obj.data) ||
      isTypedArray(obj.data)))
}

var values = function (obj) {
  return sortedObjectKeys(obj).map(function (key) { return obj[key] })
}

var flattenUtils = {
  shape: arrayShape$1,
  flatten: flattenArray
};

function flatten1D (array, nx, out) {
  for (var i = 0; i < nx; ++i) {
    out[i] = array[i]
  }
}

function flatten2D (array, nx, ny, out) {
  var ptr = 0
  for (var i = 0; i < nx; ++i) {
    var row = array[i]
    for (var j = 0; j < ny; ++j) {
      out[ptr++] = row[j]
    }
  }
}

function flatten3D (array, nx, ny, nz, out, ptr_) {
  var ptr = ptr_
  for (var i = 0; i < nx; ++i) {
    var row = array[i]
    for (var j = 0; j < ny; ++j) {
      var col = row[j]
      for (var k = 0; k < nz; ++k) {
        out[ptr++] = col[k]
      }
    }
  }
}

function flattenRec (array, shape, level, out, ptr) {
  var stride = 1
  for (var i = level + 1; i < shape.length; ++i) {
    stride *= shape[i]
  }
  var n = shape[level]
  if (shape.length - level === 4) {
    var nx = shape[level + 1]
    var ny = shape[level + 2]
    var nz = shape[level + 3]
    for (i = 0; i < n; ++i) {
      flatten3D(array[i], nx, ny, nz, out, ptr)
      ptr += stride
    }
  } else {
    for (i = 0; i < n; ++i) {
      flattenRec(array[i], shape, level + 1, out, ptr)
      ptr += stride
    }
  }
}

function flattenArray (array, shape, type, out_) {
  var sz = 1
  if (shape.length) {
    for (var i = 0; i < shape.length; ++i) {
      sz *= shape[i]
    }
  } else {
    sz = 0
  }
  var out = out_ || pool.allocType(type, sz)
  switch (shape.length) {
    case 0:
      break
    case 1:
      flatten1D(array, shape[0], out)
      break
    case 2:
      flatten2D(array, shape[0], shape[1], out)
      break
    case 3:
      flatten3D(array, shape[0], shape[1], shape[2], out, 0)
      break
    default:
      flattenRec(array, shape, 0, out, 0)
  }
  return out
}

function arrayShape$1 (array_) {
  var shape = []
  for (var array = array_; array.length; array = array[0]) {
    shape.push(array.length)
  }
  return shape
}

var arrayTypes =  {
	"[object Int8Array]": 5120,
	"[object Int16Array]": 5122,
	"[object Int32Array]": 5124,
	"[object Uint8Array]": 5121,
	"[object Uint8ClampedArray]": 5121,
	"[object Uint16Array]": 5123,
	"[object Uint32Array]": 5125,
	"[object Float32Array]": 5126,
	"[object Float64Array]": 5121,
	"[object ArrayBuffer]": 5121
};

var int8 = 5120;
var int16 = 5122;
var int32 = 5124;
var uint8 = 5121;
var uint16 = 5123;
var uint32 = 5125;
var float = 5126;
var float32 = 5126;
var glTypes = {
	int8: int8,
	int16: int16,
	int32: int32,
	uint8: uint8,
	uint16: uint16,
	uint32: uint32,
	float: float,
	float32: float32
};

var dynamic$1 = 35048;
var stream = 35040;
var usageTypes = {
	dynamic: dynamic$1,
	stream: stream,
	"static": 35044
};

var arrayFlatten = flattenUtils.flatten
var arrayShape = flattenUtils.shape

var GL_STATIC_DRAW = 0x88E4
var GL_STREAM_DRAW = 0x88E0

var GL_UNSIGNED_BYTE$3 = 5121
var GL_FLOAT$3 = 5126

var DTYPES_SIZES = []
DTYPES_SIZES[5120] = 1 // int8
DTYPES_SIZES[5122] = 2 // int16
DTYPES_SIZES[5124] = 4 // int32
DTYPES_SIZES[5121] = 1 // uint8
DTYPES_SIZES[5123] = 2 // uint16
DTYPES_SIZES[5125] = 4 // uint32
DTYPES_SIZES[5126] = 4 // float32

function typedArrayCode (data) {
  return arrayTypes[Object.prototype.toString.call(data)] | 0
}

function copyArray (out, inp) {
  for (var i = 0; i < inp.length; ++i) {
    out[i] = inp[i]
  }
}

function transpose (
  result, data, shapeX, shapeY, strideX, strideY, offset) {
  var ptr = 0
  for (var i = 0; i < shapeX; ++i) {
    for (var j = 0; j < shapeY; ++j) {
      result[ptr++] = data[strideX * i + strideY * j + offset]
    }
  }
}

function wrapBufferState (gl, stats, config, destroyBuffer) {
  var bufferCount = 0
  var bufferSet = {}

  function REGLBuffer (type) {
    this.id = bufferCount++
    this.buffer = gl.createBuffer()
    this.type = type
    this.usage = GL_STATIC_DRAW
    this.byteLength = 0
    this.dimension = 1
    this.dtype = GL_UNSIGNED_BYTE$3

    this.persistentData = null

    if (config.profile) {
      this.stats = { size: 0 }
    }
  }

  REGLBuffer.prototype.bind = function () {
    gl.bindBuffer(this.type, this.buffer)
  }

  REGLBuffer.prototype.destroy = function () {
    destroy(this)
  }

  var streamPool = []

  function createStream (type, data) {
    var buffer = streamPool.pop()
    if (!buffer) {
      buffer = new REGLBuffer(type)
    }
    buffer.bind()
    initBufferFromData(buffer, data, GL_STREAM_DRAW, 0, 1, false)
    return buffer
  }

  function destroyStream (stream$$1) {
    streamPool.push(stream$$1)
  }

  function initBufferFromTypedArray (buffer, data, usage) {
    buffer.byteLength = data.byteLength
    gl.bufferData(buffer.type, data, usage)
  }

  function initBufferFromData (buffer, data, usage, dtype, dimension, persist) {
    var shape
    buffer.usage = usage
    if (Array.isArray(data)) {
      buffer.dtype = dtype || GL_FLOAT$3
      if (data.length > 0) {
        var flatData
        if (Array.isArray(data[0])) {
          shape = arrayShape(data)
          var dim = 1
          for (var i = 1; i < shape.length; ++i) {
            dim *= shape[i]
          }
          buffer.dimension = dim
          flatData = arrayFlatten(data, shape, buffer.dtype)
          initBufferFromTypedArray(buffer, flatData, usage)
          if (persist) {
            buffer.persistentData = flatData
          } else {
            pool.freeType(flatData)
          }
        } else if (typeof data[0] === 'number') {
          buffer.dimension = dimension
          var typedData = pool.allocType(buffer.dtype, data.length)
          copyArray(typedData, data)
          initBufferFromTypedArray(buffer, typedData, usage)
          if (persist) {
            buffer.persistentData = typedData
          } else {
            pool.freeType(typedData)
          }
        } else if (isTypedArray(data[0])) {
          buffer.dimension = data[0].length
          buffer.dtype = dtype || typedArrayCode(data[0]) || GL_FLOAT$3
          flatData = arrayFlatten(
            data,
            [data.length, data[0].length],
            buffer.dtype)
          initBufferFromTypedArray(buffer, flatData, usage)
          if (persist) {
            buffer.persistentData = flatData
          } else {
            pool.freeType(flatData)
          }
        } else {
          check$1.raise('invalid buffer data')
        }
      }
    } else if (isTypedArray(data)) {
      buffer.dtype = dtype || typedArrayCode(data)
      buffer.dimension = dimension
      initBufferFromTypedArray(buffer, data, usage)
      if (persist) {
        buffer.persistentData = new Uint8Array(new Uint8Array(data.buffer))
      }
    } else if (isNDArrayLike(data)) {
      shape = data.shape
      var stride = data.stride
      var offset = data.offset

      var shapeX = 0
      var shapeY = 0
      var strideX = 0
      var strideY = 0
      if (shape.length === 1) {
        shapeX = shape[0]
        shapeY = 1
        strideX = stride[0]
        strideY = 0
      } else if (shape.length === 2) {
        shapeX = shape[0]
        shapeY = shape[1]
        strideX = stride[0]
        strideY = stride[1]
      } else {
        check$1.raise('invalid shape')
      }

      buffer.dtype = dtype || typedArrayCode(data.data) || GL_FLOAT$3
      buffer.dimension = shapeY

      var transposeData = pool.allocType(buffer.dtype, shapeX * shapeY)
      transpose(transposeData,
        data.data,
        shapeX, shapeY,
        strideX, strideY,
        offset)
      initBufferFromTypedArray(buffer, transposeData, usage)
      if (persist) {
        buffer.persistentData = transposeData
      } else {
        pool.freeType(transposeData)
      }
    } else if (data instanceof ArrayBuffer) {
      buffer.dtype = GL_UNSIGNED_BYTE$3
      buffer.dimension = dimension
      initBufferFromTypedArray(buffer, data, usage)
      if (persist) {
        buffer.persistentData = new Uint8Array(new Uint8Array(data))
      }
    } else {
      check$1.raise('invalid buffer data')
    }
  }

  function destroy (buffer) {
    stats.bufferCount--

    // remove attribute link
    destroyBuffer(buffer)

    var handle = buffer.buffer
    check$1(handle, 'buffer must not be deleted already')
    gl.deleteBuffer(handle)
    buffer.buffer = null
    delete bufferSet[buffer.id]
  }

  function createBuffer (options, type, deferInit, persistent) {
    stats.bufferCount++

    var buffer = new REGLBuffer(type)
    bufferSet[buffer.id] = buffer

    function reglBuffer (options) {
      var usage = GL_STATIC_DRAW
      var data = null
      var byteLength = 0
      var dtype = 0
      var dimension = 1
      if (Array.isArray(options) ||
          isTypedArray(options) ||
          isNDArrayLike(options) ||
          options instanceof ArrayBuffer) {
        data = options
      } else if (typeof options === 'number') {
        byteLength = options | 0
      } else if (options) {
        check$1.type(
          options, 'object',
          'buffer arguments must be an object, a number or an array')

        if ('data' in options) {
          check$1(
            data === null ||
            Array.isArray(data) ||
            isTypedArray(data) ||
            isNDArrayLike(data),
            'invalid data for buffer')
          data = options.data
        }

        if ('usage' in options) {
          check$1.parameter(options.usage, usageTypes, 'invalid buffer usage')
          usage = usageTypes[options.usage]
        }

        if ('type' in options) {
          check$1.parameter(options.type, glTypes, 'invalid buffer type')
          dtype = glTypes[options.type]
        }

        if ('dimension' in options) {
          check$1.type(options.dimension, 'number', 'invalid dimension')
          dimension = options.dimension | 0
        }

        if ('length' in options) {
          check$1.nni(byteLength, 'buffer length must be a nonnegative integer')
          byteLength = options.length | 0
        }
      }

      buffer.bind()
      if (!data) {
        // #475
        if (byteLength) gl.bufferData(buffer.type, byteLength, usage)
        buffer.dtype = dtype || GL_UNSIGNED_BYTE$3
        buffer.usage = usage
        buffer.dimension = dimension
        buffer.byteLength = byteLength
      } else {
        initBufferFromData(buffer, data, usage, dtype, dimension, persistent)
      }

      if (config.profile) {
        buffer.stats.size = buffer.byteLength * DTYPES_SIZES[buffer.dtype]
      }

      return reglBuffer
    }

    function setSubData (data, offset) {
      check$1(offset + data.byteLength <= buffer.byteLength,
        'invalid buffer subdata call, buffer is too small. ' + ' Can\'t write data of size ' + data.byteLength + ' starting from offset ' + offset + ' to a buffer of size ' + buffer.byteLength)

      gl.bufferSubData(buffer.type, offset, data)
    }

    function subdata (data, offset_) {
      var offset = (offset_ || 0) | 0
      var shape
      buffer.bind()
      if (isTypedArray(data) || data instanceof ArrayBuffer) {
        setSubData(data, offset)
      } else if (Array.isArray(data)) {
        if (data.length > 0) {
          if (typeof data[0] === 'number') {
            var converted = pool.allocType(buffer.dtype, data.length)
            copyArray(converted, data)
            setSubData(converted, offset)
            pool.freeType(converted)
          } else if (Array.isArray(data[0]) || isTypedArray(data[0])) {
            shape = arrayShape(data)
            var flatData = arrayFlatten(data, shape, buffer.dtype)
            setSubData(flatData, offset)
            pool.freeType(flatData)
          } else {
            check$1.raise('invalid buffer data')
          }
        }
      } else if (isNDArrayLike(data)) {
        shape = data.shape
        var stride = data.stride

        var shapeX = 0
        var shapeY = 0
        var strideX = 0
        var strideY = 0
        if (shape.length === 1) {
          shapeX = shape[0]
          shapeY = 1
          strideX = stride[0]
          strideY = 0
        } else if (shape.length === 2) {
          shapeX = shape[0]
          shapeY = shape[1]
          strideX = stride[0]
          strideY = stride[1]
        } else {
          check$1.raise('invalid shape')
        }
        var dtype = Array.isArray(data.data)
          ? buffer.dtype
          : typedArrayCode(data.data)

        var transposeData = pool.allocType(dtype, shapeX * shapeY)
        transpose(transposeData,
          data.data,
          shapeX, shapeY,
          strideX, strideY,
          data.offset)
        setSubData(transposeData, offset)
        pool.freeType(transposeData)
      } else {
        check$1.raise('invalid data for buffer subdata')
      }
      return reglBuffer
    }

    if (!deferInit) {
      reglBuffer(options)
    }

    reglBuffer._reglType = 'buffer'
    reglBuffer._buffer = buffer
    reglBuffer.subdata = subdata
    if (config.profile) {
      reglBuffer.stats = buffer.stats
    }
    reglBuffer.destroy = function () { destroy(buffer) }

    return reglBuffer
  }

  function restoreBuffers () {
    values(bufferSet).forEach(function (buffer) {
      buffer.buffer = gl.createBuffer()
      gl.bindBuffer(buffer.type, buffer.buffer)
      gl.bufferData(
        buffer.type, buffer.persistentData || buffer.byteLength, buffer.usage)
    })
  }

  if (config.profile) {
    stats.getTotalBufferSize = function () {
      var total = 0
      // TODO: Right now, the streams are not part of the total count.
      sortedObjectKeys(bufferSet).forEach(function (key) {
        total += bufferSet[key].stats.size
      })
      return total
    }
  }

  return {
    create: createBuffer,

    createStream: createStream,
    destroyStream: destroyStream,

    clear: function () {
      values(bufferSet).forEach(destroy)
      streamPool.forEach(destroy)
    },

    getBuffer: function (wrapper) {
      if (wrapper && wrapper._buffer instanceof REGLBuffer) {
        return wrapper._buffer
      }
      return null
    },

    restore: restoreBuffers,

    _initBuffer: initBufferFromData
  }
}

var points = 0;
var point = 0;
var lines = 1;
var line = 1;
var triangles = 4;
var triangle = 4;
var primTypes = {
	points: points,
	point: point,
	lines: lines,
	line: line,
	triangles: triangles,
	triangle: triangle,
	"line loop": 2,
	"line strip": 3,
	"triangle strip": 5,
	"triangle fan": 6
};

var GL_POINTS = 0
var GL_LINES = 1
var GL_TRIANGLES = 4

var GL_BYTE$2 = 5120
var GL_UNSIGNED_BYTE$4 = 5121
var GL_SHORT$2 = 5122
var GL_UNSIGNED_SHORT$2 = 5123
var GL_INT$2 = 5124
var GL_UNSIGNED_INT$2 = 5125

var GL_ELEMENT_ARRAY_BUFFER = 34963

var GL_STREAM_DRAW$1 = 0x88E0
var GL_STATIC_DRAW$1 = 0x88E4

function wrapElementsState (gl, extensions, bufferState, stats) {
  var elementSet = {}
  var elementCount = 0

  var elementTypes = {
    'uint8': GL_UNSIGNED_BYTE$4,
    'uint16': GL_UNSIGNED_SHORT$2
  }

  if (extensions.oes_element_index_uint) {
    elementTypes.uint32 = GL_UNSIGNED_INT$2
  }

  function REGLElementBuffer (buffer) {
    this.id = elementCount++
    elementSet[this.id] = this
    this.buffer = buffer
    this.primType = GL_TRIANGLES
    this.vertCount = 0
    this.type = 0
  }

  REGLElementBuffer.prototype.bind = function () {
    this.buffer.bind()
  }

  var bufferPool = []

  function createElementStream (data) {
    var result = bufferPool.pop()
    if (!result) {
      result = new REGLElementBuffer(bufferState.create(
        null,
        GL_ELEMENT_ARRAY_BUFFER,
        true,
        false)._buffer)
    }
    initElements(result, data, GL_STREAM_DRAW$1, -1, -1, 0, 0)
    return result
  }

  function destroyElementStream (elements) {
    bufferPool.push(elements)
  }

  function initElements (
    elements,
    data,
    usage,
    prim,
    count,
    byteLength,
    type) {
    elements.buffer.bind()
    var dtype
    if (data) {
      var predictedType = type
      if (!type && (
        !isTypedArray(data) ||
         (isNDArrayLike(data) && !isTypedArray(data.data)))) {
        predictedType = extensions.oes_element_index_uint
          ? GL_UNSIGNED_INT$2
          : GL_UNSIGNED_SHORT$2
      }
      bufferState._initBuffer(
        elements.buffer,
        data,
        usage,
        predictedType,
        3)
    } else {
      gl.bufferData(GL_ELEMENT_ARRAY_BUFFER, byteLength, usage)
      elements.buffer.dtype = dtype || GL_UNSIGNED_BYTE$4
      elements.buffer.usage = usage
      elements.buffer.dimension = 3
      elements.buffer.byteLength = byteLength
    }

    dtype = type
    if (!type) {
      switch (elements.buffer.dtype) {
        case GL_UNSIGNED_BYTE$4:
        case GL_BYTE$2:
          dtype = GL_UNSIGNED_BYTE$4
          break

        case GL_UNSIGNED_SHORT$2:
        case GL_SHORT$2:
          dtype = GL_UNSIGNED_SHORT$2
          break

        case GL_UNSIGNED_INT$2:
        case GL_INT$2:
          dtype = GL_UNSIGNED_INT$2
          break

        default:
          check$1.raise('unsupported type for element array')
      }
      elements.buffer.dtype = dtype
    }
    elements.type = dtype

    // Check oes_element_index_uint extension
    check$1(
      dtype !== GL_UNSIGNED_INT$2 ||
      !!extensions.oes_element_index_uint,
      '32 bit element buffers not supported, enable oes_element_index_uint first')

    // try to guess default primitive type and arguments
    var vertCount = count
    if (vertCount < 0) {
      vertCount = elements.buffer.byteLength
      if (dtype === GL_UNSIGNED_SHORT$2) {
        vertCount >>= 1
      } else if (dtype === GL_UNSIGNED_INT$2) {
        vertCount >>= 2
      }
    }
    elements.vertCount = vertCount

    // try to guess primitive type from cell dimension
    var primType = prim
    if (prim < 0) {
      primType = GL_TRIANGLES
      var dimension = elements.buffer.dimension
      if (dimension === 1) primType = GL_POINTS
      if (dimension === 2) primType = GL_LINES
      if (dimension === 3) primType = GL_TRIANGLES
    }
    elements.primType = primType
  }

  function destroyElements (elements) {
    stats.elementsCount--

    check$1(elements.buffer !== null, 'must not double destroy elements')
    delete elementSet[elements.id]
    elements.buffer.destroy()
    elements.buffer = null
  }

  function createElements (options, persistent) {
    var buffer = bufferState.create(null, GL_ELEMENT_ARRAY_BUFFER, true)
    var elements = new REGLElementBuffer(buffer._buffer)
    stats.elementsCount++

    function reglElements (options) {
      if (!options) {
        buffer()
        elements.primType = GL_TRIANGLES
        elements.vertCount = 0
        elements.type = GL_UNSIGNED_BYTE$4
      } else if (typeof options === 'number') {
        buffer(options)
        elements.primType = GL_TRIANGLES
        elements.vertCount = options | 0
        elements.type = GL_UNSIGNED_BYTE$4
      } else {
        var data = null
        var usage = GL_STATIC_DRAW$1
        var primType = -1
        var vertCount = -1
        var byteLength = 0
        var dtype = 0
        if (Array.isArray(options) ||
            isTypedArray(options) ||
            isNDArrayLike(options)) {
          data = options
        } else {
          check$1.type(options, 'object', 'invalid arguments for elements')
          if ('data' in options) {
            data = options.data
            check$1(
              Array.isArray(data) ||
                isTypedArray(data) ||
                isNDArrayLike(data),
              'invalid data for element buffer')
          }
          if ('usage' in options) {
            check$1.parameter(
              options.usage,
              usageTypes,
              'invalid element buffer usage')
            usage = usageTypes[options.usage]
          }
          if ('primitive' in options) {
            check$1.parameter(
              options.primitive,
              primTypes,
              'invalid element buffer primitive')
            primType = primTypes[options.primitive]
          }
          if ('count' in options) {
            check$1(
              typeof options.count === 'number' && options.count >= 0,
              'invalid vertex count for elements')
            vertCount = options.count | 0
          }
          if ('type' in options) {
            check$1.parameter(
              options.type,
              elementTypes,
              'invalid buffer type')
            dtype = elementTypes[options.type]
          }
          if ('length' in options) {
            byteLength = options.length | 0
          } else {
            byteLength = vertCount
            if (dtype === GL_UNSIGNED_SHORT$2 || dtype === GL_SHORT$2) {
              byteLength *= 2
            } else if (dtype === GL_UNSIGNED_INT$2 || dtype === GL_INT$2) {
              byteLength *= 4
            }
          }
        }
        initElements(
          elements,
          data,
          usage,
          primType,
          vertCount,
          byteLength,
          dtype)
      }

      return reglElements
    }

    reglElements(options)

    reglElements._reglType = 'elements'
    reglElements._elements = elements
    reglElements.subdata = function (data, offset) {
      buffer.subdata(data, offset)
      return reglElements
    }
    reglElements.destroy = function () {
      destroyElements(elements)
    }

    return reglElements
  }

  return {
    create: createElements,
    createStream: createElementStream,
    destroyStream: destroyElementStream,
    getElements: function (elements) {
      if (typeof elements === 'function' &&
          elements._elements instanceof REGLElementBuffer) {
        return elements._elements
      }
      return null
    },
    clear: function () {
      values(elementSet).forEach(destroyElements)
    }
  }
}

var FLOAT = new Float32Array(1)
var INT = new Uint32Array(FLOAT.buffer)

var GL_UNSIGNED_SHORT$4 = 5123

function convertToHalfFloat (array) {
  var ushorts = pool.allocType(GL_UNSIGNED_SHORT$4, array.length)

  for (var i = 0; i < array.length; ++i) {
    if (isNaN(array[i])) {
      ushorts[i] = 0xffff
    } else if (array[i] === Infinity) {
      ushorts[i] = 0x7c00
    } else if (array[i] === -Infinity) {
      ushorts[i] = 0xfc00
    } else {
      FLOAT[0] = array[i]
      var x = INT[0]

      var sgn = (x >>> 31) << 15
      var exp = ((x << 1) >>> 24) - 127
      var frac = (x >> 13) & ((1 << 10) - 1)

      if (exp < -24) {
        // round non-representable denormals to 0
        ushorts[i] = sgn
      } else if (exp < -14) {
        // handle denormals
        var s = -14 - exp
        ushorts[i] = sgn + ((frac + (1 << 10)) >> s)
      } else if (exp > 15) {
        // round overflow to +/- Infinity
        ushorts[i] = sgn + 0x7c00
      } else {
        // otherwise convert directly
        ushorts[i] = sgn + ((exp + 15) << 10) + frac
      }
    }
  }

  return ushorts
}

function isArrayLike (s) {
  return Array.isArray(s) || isTypedArray(s)
}

var isPow2$1 = function (v) {
  return !(v & (v - 1)) && (!!v)
}

var GL_COMPRESSED_TEXTURE_FORMATS = 0x86A3

var GL_TEXTURE_2D$1 = 0x0DE1
var GL_TEXTURE_CUBE_MAP$1 = 0x8513
var GL_TEXTURE_CUBE_MAP_POSITIVE_X$1 = 0x8515

var GL_RGBA$1 = 0x1908
var GL_ALPHA = 0x1906
var GL_RGB = 0x1907
var GL_LUMINANCE = 0x1909
var GL_LUMINANCE_ALPHA = 0x190A

var GL_RGBA4 = 0x8056
var GL_RGB5_A1 = 0x8057
var GL_RGB565 = 0x8D62

var GL_UNSIGNED_SHORT_4_4_4_4$1 = 0x8033
var GL_UNSIGNED_SHORT_5_5_5_1$1 = 0x8034
var GL_UNSIGNED_SHORT_5_6_5$1 = 0x8363
var GL_UNSIGNED_INT_24_8_WEBGL$1 = 0x84FA

var GL_DEPTH_COMPONENT = 0x1902
var GL_DEPTH_STENCIL = 0x84F9

var GL_SRGB_EXT = 0x8C40
var GL_SRGB_ALPHA_EXT = 0x8C42

var GL_HALF_FLOAT_OES$1 = 0x8D61

var GL_COMPRESSED_RGB_S3TC_DXT1_EXT = 0x83F0
var GL_COMPRESSED_RGBA_S3TC_DXT1_EXT = 0x83F1
var GL_COMPRESSED_RGBA_S3TC_DXT3_EXT = 0x83F2
var GL_COMPRESSED_RGBA_S3TC_DXT5_EXT = 0x83F3

var GL_COMPRESSED_RGB_ATC_WEBGL = 0x8C92
var GL_COMPRESSED_RGBA_ATC_EXPLICIT_ALPHA_WEBGL = 0x8C93
var GL_COMPRESSED_RGBA_ATC_INTERPOLATED_ALPHA_WEBGL = 0x87EE

var GL_COMPRESSED_RGB_PVRTC_4BPPV1_IMG = 0x8C00
var GL_COMPRESSED_RGB_PVRTC_2BPPV1_IMG = 0x8C01
var GL_COMPRESSED_RGBA_PVRTC_4BPPV1_IMG = 0x8C02
var GL_COMPRESSED_RGBA_PVRTC_2BPPV1_IMG = 0x8C03

var GL_COMPRESSED_RGB_ETC1_WEBGL = 0x8D64

var GL_UNSIGNED_BYTE$5 = 0x1401
var GL_UNSIGNED_SHORT$3 = 0x1403
var GL_UNSIGNED_INT$3 = 0x1405
var GL_FLOAT$4 = 0x1406

var GL_TEXTURE_WRAP_S = 0x2802
var GL_TEXTURE_WRAP_T = 0x2803

var GL_REPEAT = 0x2901
var GL_CLAMP_TO_EDGE$1 = 0x812F
var GL_MIRRORED_REPEAT = 0x8370

var GL_TEXTURE_MAG_FILTER = 0x2800
var GL_TEXTURE_MIN_FILTER = 0x2801

var GL_NEAREST$1 = 0x2600
var GL_LINEAR = 0x2601
var GL_NEAREST_MIPMAP_NEAREST$1 = 0x2700
var GL_LINEAR_MIPMAP_NEAREST$1 = 0x2701
var GL_NEAREST_MIPMAP_LINEAR$1 = 0x2702
var GL_LINEAR_MIPMAP_LINEAR$1 = 0x2703

var GL_GENERATE_MIPMAP_HINT = 0x8192
var GL_DONT_CARE = 0x1100
var GL_FASTEST = 0x1101
var GL_NICEST = 0x1102

var GL_TEXTURE_MAX_ANISOTROPY_EXT = 0x84FE

var GL_UNPACK_ALIGNMENT = 0x0CF5
var GL_UNPACK_FLIP_Y_WEBGL = 0x9240
var GL_UNPACK_PREMULTIPLY_ALPHA_WEBGL = 0x9241
var GL_UNPACK_COLORSPACE_CONVERSION_WEBGL = 0x9243

var GL_BROWSER_DEFAULT_WEBGL = 0x9244

var GL_TEXTURE0$1 = 0x84C0

var MIPMAP_FILTERS = [
  GL_NEAREST_MIPMAP_NEAREST$1,
  GL_NEAREST_MIPMAP_LINEAR$1,
  GL_LINEAR_MIPMAP_NEAREST$1,
  GL_LINEAR_MIPMAP_LINEAR$1
]

var CHANNELS_FORMAT = [
  0,
  GL_LUMINANCE,
  GL_LUMINANCE_ALPHA,
  GL_RGB,
  GL_RGBA$1
]

var FORMAT_CHANNELS = {}
FORMAT_CHANNELS[GL_LUMINANCE] =
FORMAT_CHANNELS[GL_ALPHA] =
FORMAT_CHANNELS[GL_DEPTH_COMPONENT] = 1
FORMAT_CHANNELS[GL_DEPTH_STENCIL] =
FORMAT_CHANNELS[GL_LUMINANCE_ALPHA] = 2
FORMAT_CHANNELS[GL_RGB] =
FORMAT_CHANNELS[GL_SRGB_EXT] = 3
FORMAT_CHANNELS[GL_RGBA$1] =
FORMAT_CHANNELS[GL_SRGB_ALPHA_EXT] = 4

function objectName (str) {
  return '[object ' + str + ']'
}

var CANVAS_CLASS = objectName('HTMLCanvasElement')
var OFFSCREENCANVAS_CLASS = objectName('OffscreenCanvas')
var CONTEXT2D_CLASS = objectName('CanvasRenderingContext2D')
var BITMAP_CLASS = objectName('ImageBitmap')
var IMAGE_CLASS = objectName('HTMLImageElement')
var VIDEO_CLASS = objectName('HTMLVideoElement')

var PIXEL_CLASSES = sortedObjectKeys(arrayTypes).concat([
  CANVAS_CLASS,
  OFFSCREENCANVAS_CLASS,
  CONTEXT2D_CLASS,
  BITMAP_CLASS,
  IMAGE_CLASS,
  VIDEO_CLASS
])

// for every texture type, store
// the size in bytes.
var TYPE_SIZES = []
TYPE_SIZES[GL_UNSIGNED_BYTE$5] = 1
TYPE_SIZES[GL_FLOAT$4] = 4
TYPE_SIZES[GL_HALF_FLOAT_OES$1] = 2

TYPE_SIZES[GL_UNSIGNED_SHORT$3] = 2
TYPE_SIZES[GL_UNSIGNED_INT$3] = 4

var FORMAT_SIZES_SPECIAL = []
FORMAT_SIZES_SPECIAL[GL_RGBA4] = 2
FORMAT_SIZES_SPECIAL[GL_RGB5_A1] = 2
FORMAT_SIZES_SPECIAL[GL_RGB565] = 2
FORMAT_SIZES_SPECIAL[GL_DEPTH_STENCIL] = 4

FORMAT_SIZES_SPECIAL[GL_COMPRESSED_RGB_S3TC_DXT1_EXT] = 0.5
FORMAT_SIZES_SPECIAL[GL_COMPRESSED_RGBA_S3TC_DXT1_EXT] = 0.5
FORMAT_SIZES_SPECIAL[GL_COMPRESSED_RGBA_S3TC_DXT3_EXT] = 1
FORMAT_SIZES_SPECIAL[GL_COMPRESSED_RGBA_S3TC_DXT5_EXT] = 1

FORMAT_SIZES_SPECIAL[GL_COMPRESSED_RGB_ATC_WEBGL] = 0.5
FORMAT_SIZES_SPECIAL[GL_COMPRESSED_RGBA_ATC_EXPLICIT_ALPHA_WEBGL] = 1
FORMAT_SIZES_SPECIAL[GL_COMPRESSED_RGBA_ATC_INTERPOLATED_ALPHA_WEBGL] = 1

FORMAT_SIZES_SPECIAL[GL_COMPRESSED_RGB_PVRTC_4BPPV1_IMG] = 0.5
FORMAT_SIZES_SPECIAL[GL_COMPRESSED_RGB_PVRTC_2BPPV1_IMG] = 0.25
FORMAT_SIZES_SPECIAL[GL_COMPRESSED_RGBA_PVRTC_4BPPV1_IMG] = 0.5
FORMAT_SIZES_SPECIAL[GL_COMPRESSED_RGBA_PVRTC_2BPPV1_IMG] = 0.25

FORMAT_SIZES_SPECIAL[GL_COMPRESSED_RGB_ETC1_WEBGL] = 0.5

function isNumericArray (arr) {
  return (
    Array.isArray(arr) &&
    (arr.length === 0 ||
    typeof arr[0] === 'number'))
}

function isRectArray (arr) {
  if (!Array.isArray(arr)) {
    return false
  }
  var width = arr.length
  if (width === 0 || !isArrayLike(arr[0])) {
    return false
  }
  return true
}

function classString (x) {
  return Object.prototype.toString.call(x)
}

function isCanvasElement (object) {
  return classString(object) === CANVAS_CLASS
}

function isOffscreenCanvas (object) {
  return classString(object) === OFFSCREENCANVAS_CLASS
}

function isContext2D (object) {
  return classString(object) === CONTEXT2D_CLASS
}

function isBitmap (object) {
  return classString(object) === BITMAP_CLASS
}

function isImageElement (object) {
  return classString(object) === IMAGE_CLASS
}

function isVideoElement (object) {
  return classString(object) === VIDEO_CLASS
}

function isPixelData (object) {
  if (!object) {
    return false
  }
  var className = classString(object)
  if (PIXEL_CLASSES.indexOf(className) >= 0) {
    return true
  }
  return (
    isNumericArray(object) ||
    isRectArray(object) ||
    isNDArrayLike(object))
}

function typedArrayCode$1 (data) {
  return arrayTypes[Object.prototype.toString.call(data)] | 0
}

function convertData (result, data) {
  var n = data.length
  switch (result.type) {
    case GL_UNSIGNED_BYTE$5:
    case GL_UNSIGNED_SHORT$3:
    case GL_UNSIGNED_INT$3:
    case GL_FLOAT$4:
      var converted = pool.allocType(result.type, n)
      converted.set(data)
      result.data = converted
      break

    case GL_HALF_FLOAT_OES$1:
      result.data = convertToHalfFloat(data)
      break

    default:
      check$1.raise('unsupported texture type, must specify a typed array')
  }
}

function preConvert (image, n) {
  return pool.allocType(
    image.type === GL_HALF_FLOAT_OES$1
      ? GL_FLOAT$4
      : image.type, n)
}

function postConvert (image, data) {
  if (image.type === GL_HALF_FLOAT_OES$1) {
    image.data = convertToHalfFloat(data)
    pool.freeType(data)
  } else {
    image.data = data
  }
}

function transposeData (image, array, strideX, strideY, strideC, offset) {
  var w = image.width
  var h = image.height
  var c = image.channels
  var n = w * h * c
  var data = preConvert(image, n)

  var p = 0
  for (var i = 0; i < h; ++i) {
    for (var j = 0; j < w; ++j) {
      for (var k = 0; k < c; ++k) {
        data[p++] = array[strideX * j + strideY * i + strideC * k + offset]
      }
    }
  }

  postConvert(image, data)
}

function getTextureSize (format, type, width, height, isMipmap, isCube) {
  var s
  if (typeof FORMAT_SIZES_SPECIAL[format] !== 'undefined') {
    // we have a special array for dealing with weird color formats such as RGB5A1
    s = FORMAT_SIZES_SPECIAL[format]
  } else {
    s = FORMAT_CHANNELS[format] * TYPE_SIZES[type]
  }

  if (isCube) {
    s *= 6
  }

  if (isMipmap) {
    // compute the total size of all the mipmaps.
    var total = 0

    var w = width
    while (w >= 1) {
      // we can only use mipmaps on a square image,
      // so we can simply use the width and ignore the height:
      total += s * w * w
      w /= 2
    }
    return total
  } else {
    return s * width * height
  }
}

function createTextureSet (
  gl, extensions, limits, reglPoll, contextState, stats, config) {
  // -------------------------------------------------------
  // Initialize constants and parameter tables here
  // -------------------------------------------------------
  var mipmapHint = {
    "don't care": GL_DONT_CARE,
    'dont care': GL_DONT_CARE,
    'nice': GL_NICEST,
    'fast': GL_FASTEST
  }

  var wrapModes = {
    'repeat': GL_REPEAT,
    'clamp': GL_CLAMP_TO_EDGE$1,
    'mirror': GL_MIRRORED_REPEAT
  }

  var magFilters = {
    'nearest': GL_NEAREST$1,
    'linear': GL_LINEAR
  }

  var minFilters = extend({
    'mipmap': GL_LINEAR_MIPMAP_LINEAR$1,
    'nearest mipmap nearest': GL_NEAREST_MIPMAP_NEAREST$1,
    'linear mipmap nearest': GL_LINEAR_MIPMAP_NEAREST$1,
    'nearest mipmap linear': GL_NEAREST_MIPMAP_LINEAR$1,
    'linear mipmap linear': GL_LINEAR_MIPMAP_LINEAR$1
  }, magFilters)

  var colorSpace = {
    'none': 0,
    'browser': GL_BROWSER_DEFAULT_WEBGL
  }

  var textureTypes = {
    'uint8': GL_UNSIGNED_BYTE$5,
    'rgba4': GL_UNSIGNED_SHORT_4_4_4_4$1,
    'rgb565': GL_UNSIGNED_SHORT_5_6_5$1,
    'rgb5 a1': GL_UNSIGNED_SHORT_5_5_5_1$1
  }

  var textureFormats = {
    'alpha': GL_ALPHA,
    'luminance': GL_LUMINANCE,
    'luminance alpha': GL_LUMINANCE_ALPHA,
    'rgb': GL_RGB,
    'rgba': GL_RGBA$1,
    'rgba4': GL_RGBA4,
    'rgb5 a1': GL_RGB5_A1,
    'rgb565': GL_RGB565
  }

  var compressedTextureFormats = {}

  if (extensions.ext_srgb) {
    textureFormats.srgb = GL_SRGB_EXT
    textureFormats.srgba = GL_SRGB_ALPHA_EXT
  }

  if (extensions.oes_texture_float) {
    textureTypes.float32 = textureTypes.float = GL_FLOAT$4
  }

  if (extensions.oes_texture_half_float) {
    textureTypes['float16'] = textureTypes['half float'] = GL_HALF_FLOAT_OES$1
  }

  if (extensions.webgl_depth_texture) {
    extend(textureFormats, {
      'depth': GL_DEPTH_COMPONENT,
      'depth stencil': GL_DEPTH_STENCIL
    })

    extend(textureTypes, {
      'uint16': GL_UNSIGNED_SHORT$3,
      'uint32': GL_UNSIGNED_INT$3,
      'depth stencil': GL_UNSIGNED_INT_24_8_WEBGL$1
    })
  }

  if (extensions.webgl_compressed_texture_s3tc) {
    extend(compressedTextureFormats, {
      'rgb s3tc dxt1': GL_COMPRESSED_RGB_S3TC_DXT1_EXT,
      'rgba s3tc dxt1': GL_COMPRESSED_RGBA_S3TC_DXT1_EXT,
      'rgba s3tc dxt3': GL_COMPRESSED_RGBA_S3TC_DXT3_EXT,
      'rgba s3tc dxt5': GL_COMPRESSED_RGBA_S3TC_DXT5_EXT
    })
  }

  if (extensions.webgl_compressed_texture_atc) {
    extend(compressedTextureFormats, {
      'rgb atc': GL_COMPRESSED_RGB_ATC_WEBGL,
      'rgba atc explicit alpha': GL_COMPRESSED_RGBA_ATC_EXPLICIT_ALPHA_WEBGL,
      'rgba atc interpolated alpha': GL_COMPRESSED_RGBA_ATC_INTERPOLATED_ALPHA_WEBGL
    })
  }

  if (extensions.webgl_compressed_texture_pvrtc) {
    extend(compressedTextureFormats, {
      'rgb pvrtc 4bppv1': GL_COMPRESSED_RGB_PVRTC_4BPPV1_IMG,
      'rgb pvrtc 2bppv1': GL_COMPRESSED_RGB_PVRTC_2BPPV1_IMG,
      'rgba pvrtc 4bppv1': GL_COMPRESSED_RGBA_PVRTC_4BPPV1_IMG,
      'rgba pvrtc 2bppv1': GL_COMPRESSED_RGBA_PVRTC_2BPPV1_IMG
    })
  }

  if (extensions.webgl_compressed_texture_etc1) {
    compressedTextureFormats['rgb etc1'] = GL_COMPRESSED_RGB_ETC1_WEBGL
  }

  // Copy over all texture formats
  var supportedCompressedFormats = Array.prototype.slice.call(
    gl.getParameter(GL_COMPRESSED_TEXTURE_FORMATS))
  sortedObjectKeys(compressedTextureFormats).forEach(function (name) {
    var format = compressedTextureFormats[name]
    if (supportedCompressedFormats.indexOf(format) >= 0) {
      textureFormats[name] = format
    }
  })

  var supportedFormats = sortedObjectKeys(textureFormats)
  limits.textureFormats = supportedFormats

  // associate with every format string its
  // corresponding GL-value.
  var textureFormatsInvert = []
  sortedObjectKeys(textureFormats).forEach(function (key) {
    var val = textureFormats[key]
    textureFormatsInvert[val] = key
  })

  // associate with every type string its
  // corresponding GL-value.
  var textureTypesInvert = []
  sortedObjectKeys(textureTypes).forEach(function (key) {
    var val = textureTypes[key]
    textureTypesInvert[val] = key
  })

  var magFiltersInvert = []
  sortedObjectKeys(magFilters).forEach(function (key) {
    var val = magFilters[key]
    magFiltersInvert[val] = key
  })

  var minFiltersInvert = []
  sortedObjectKeys(minFilters).forEach(function (key) {
    var val = minFilters[key]
    minFiltersInvert[val] = key
  })

  var wrapModesInvert = []
  sortedObjectKeys(wrapModes).forEach(function (key) {
    var val = wrapModes[key]
    wrapModesInvert[val] = key
  })

  // colorFormats[] gives the format (channels) associated to an
  // internalformat
  var colorFormats = supportedFormats.reduce(function (color, key) {
    var glenum = textureFormats[key]
    if (glenum === GL_LUMINANCE ||
        glenum === GL_ALPHA ||
        glenum === GL_LUMINANCE ||
        glenum === GL_LUMINANCE_ALPHA ||
        glenum === GL_DEPTH_COMPONENT ||
        glenum === GL_DEPTH_STENCIL ||
        (extensions.ext_srgb &&
                (glenum === GL_SRGB_EXT ||
                 glenum === GL_SRGB_ALPHA_EXT))) {
      color[glenum] = glenum
    } else if (glenum === GL_RGB5_A1 || key.indexOf('rgba') >= 0) {
      color[glenum] = GL_RGBA$1
    } else {
      color[glenum] = GL_RGB
    }
    return color
  }, {})

  function TexFlags () {
    // format info
    this.internalformat = GL_RGBA$1
    this.format = GL_RGBA$1
    this.type = GL_UNSIGNED_BYTE$5
    this.compressed = false

    // pixel storage
    this.premultiplyAlpha = false
    this.flipY = false
    this.unpackAlignment = 1
    this.colorSpace = GL_BROWSER_DEFAULT_WEBGL

    // shape info
    this.width = 0
    this.height = 0
    this.channels = 0
  }

  function copyFlags (result, other) {
    result.internalformat = other.internalformat
    result.format = other.format
    result.type = other.type
    result.compressed = other.compressed

    result.premultiplyAlpha = other.premultiplyAlpha
    result.flipY = other.flipY
    result.unpackAlignment = other.unpackAlignment
    result.colorSpace = other.colorSpace

    result.width = other.width
    result.height = other.height
    result.channels = other.channels
  }

  function parseFlags (flags, options) {
    if (typeof options !== 'object' || !options) {
      return
    }

    if ('premultiplyAlpha' in options) {
      check$1.type(options.premultiplyAlpha, 'boolean',
        'invalid premultiplyAlpha')
      flags.premultiplyAlpha = options.premultiplyAlpha
    }

    if ('flipY' in options) {
      check$1.type(options.flipY, 'boolean',
        'invalid texture flip')
      flags.flipY = options.flipY
    }

    if ('alignment' in options) {
      check$1.oneOf(options.alignment, [1, 2, 4, 8],
        'invalid texture unpack alignment')
      flags.unpackAlignment = options.alignment
    }

    if ('colorSpace' in options) {
      check$1.parameter(options.colorSpace, colorSpace,
        'invalid colorSpace')
      flags.colorSpace = colorSpace[options.colorSpace]
    }

    if ('type' in options) {
      var type = options.type
      check$1(extensions.oes_texture_float ||
        !(type === 'float' || type === 'float32'),
      'you must enable the OES_texture_float extension in order to use floating point textures.')
      check$1(extensions.oes_texture_half_float ||
        !(type === 'half float' || type === 'float16'),
      'you must enable the OES_texture_half_float extension in order to use 16-bit floating point textures.')
      check$1(extensions.webgl_depth_texture ||
        !(type === 'uint16' || type === 'uint32' || type === 'depth stencil'),
      'you must enable the WEBGL_depth_texture extension in order to use depth/stencil textures.')
      check$1.parameter(type, textureTypes,
        'invalid texture type')
      flags.type = textureTypes[type]
    }

    var w = flags.width
    var h = flags.height
    var c = flags.channels
    var hasChannels = false
    if ('shape' in options) {
      check$1(Array.isArray(options.shape) && options.shape.length >= 2,
        'shape must be an array')
      w = options.shape[0]
      h = options.shape[1]
      if (options.shape.length === 3) {
        c = options.shape[2]
        check$1(c > 0 && c <= 4, 'invalid number of channels')
        hasChannels = true
      }
      check$1(w >= 0 && w <= limits.maxTextureSize, 'invalid width')
      check$1(h >= 0 && h <= limits.maxTextureSize, 'invalid height')
    } else {
      if ('radius' in options) {
        w = h = options.radius
        check$1(w >= 0 && w <= limits.maxTextureSize, 'invalid radius')
      }
      if ('width' in options) {
        w = options.width
        check$1(w >= 0 && w <= limits.maxTextureSize, 'invalid width')
      }
      if ('height' in options) {
        h = options.height
        check$1(h >= 0 && h <= limits.maxTextureSize, 'invalid height')
      }
      if ('channels' in options) {
        c = options.channels
        check$1(c > 0 && c <= 4, 'invalid number of channels')
        hasChannels = true
      }
    }
    flags.width = w | 0
    flags.height = h | 0
    flags.channels = c | 0

    var hasFormat = false
    if ('format' in options) {
      var formatStr = options.format
      check$1(extensions.webgl_depth_texture ||
        !(formatStr === 'depth' || formatStr === 'depth stencil'),
      'you must enable the WEBGL_depth_texture extension in order to use depth/stencil textures.')
      check$1.parameter(formatStr, textureFormats,
        'invalid texture format')
      var internalformat = flags.internalformat = textureFormats[formatStr]
      flags.format = colorFormats[internalformat]
      if (formatStr in textureTypes) {
        if (!('type' in options)) {
          flags.type = textureTypes[formatStr]
        }
      }
      if (formatStr in compressedTextureFormats) {
        flags.compressed = true
      }
      hasFormat = true
    }

    // Reconcile channels and format
    if (!hasChannels && hasFormat) {
      flags.channels = FORMAT_CHANNELS[flags.format]
    } else if (hasChannels && !hasFormat) {
      if (flags.channels !== CHANNELS_FORMAT[flags.format]) {
        flags.format = flags.internalformat = CHANNELS_FORMAT[flags.channels]
      }
    } else if (hasFormat && hasChannels) {
      check$1(
        flags.channels === FORMAT_CHANNELS[flags.format],
        'number of channels inconsistent with specified format')
    }
  }

  function setFlags (flags) {
    gl.pixelStorei(GL_UNPACK_FLIP_Y_WEBGL, flags.flipY)
    gl.pixelStorei(GL_UNPACK_PREMULTIPLY_ALPHA_WEBGL, flags.premultiplyAlpha)
    gl.pixelStorei(GL_UNPACK_COLORSPACE_CONVERSION_WEBGL, flags.colorSpace)
    gl.pixelStorei(GL_UNPACK_ALIGNMENT, flags.unpackAlignment)
  }

  // -------------------------------------------------------
  // Tex image data
  // -------------------------------------------------------
  function TexImage () {
    TexFlags.call(this)

    this.xOffset = 0
    this.yOffset = 0

    // data
    this.data = null
    this.needsFree = false

    // html element
    this.element = null

    // copyTexImage info
    this.needsCopy = false
  }

  function parseImage (image, options) {
    var data = null
    if (isPixelData(options)) {
      data = options
    } else if (options) {
      check$1.type(options, 'object', 'invalid pixel data type')
      parseFlags(image, options)
      if ('x' in options) {
        image.xOffset = options.x | 0
      }
      if ('y' in options) {
        image.yOffset = options.y | 0
      }
      if (isPixelData(options.data)) {
        data = options.data
      }
    }

    check$1(
      !image.compressed ||
      data instanceof Uint8Array,
      'compressed texture data must be stored in a uint8array')

    if (options.copy) {
      check$1(!data, 'can not specify copy and data field for the same texture')
      var viewW = contextState.viewportWidth
      var viewH = contextState.viewportHeight
      image.width = image.width || (viewW - image.xOffset)
      image.height = image.height || (viewH - image.yOffset)
      image.needsCopy = true
      check$1(image.xOffset >= 0 && image.xOffset < viewW &&
            image.yOffset >= 0 && image.yOffset < viewH &&
            image.width > 0 && image.width <= viewW &&
            image.height > 0 && image.height <= viewH,
      'copy texture read out of bounds')
    } else if (!data) {
      image.width = image.width || 1
      image.height = image.height || 1
      image.channels = image.channels || 4
    } else if (isTypedArray(data)) {
      image.channels = image.channels || 4
      image.data = data
      if (!('type' in options) && image.type === GL_UNSIGNED_BYTE$5) {
        image.type = typedArrayCode$1(data)
      }
    } else if (isNumericArray(data)) {
      image.channels = image.channels || 4
      convertData(image, data)
      image.alignment = 1
      image.needsFree = true
    } else if (isNDArrayLike(data)) {
      var array = data.data
      if (!Array.isArray(array) && image.type === GL_UNSIGNED_BYTE$5) {
        image.type = typedArrayCode$1(array)
      }
      var shape = data.shape
      var stride = data.stride
      var shapeX, shapeY, shapeC, strideX, strideY, strideC
      if (shape.length === 3) {
        shapeC = shape[2]
        strideC = stride[2]
      } else {
        check$1(shape.length === 2, 'invalid ndarray pixel data, must be 2 or 3D')
        shapeC = 1
        strideC = 1
      }
      shapeX = shape[0]
      shapeY = shape[1]
      strideX = stride[0]
      strideY = stride[1]
      image.alignment = 1
      image.width = shapeX
      image.height = shapeY
      image.channels = shapeC
      image.format = image.internalformat = CHANNELS_FORMAT[shapeC]
      image.needsFree = true
      transposeData(image, array, strideX, strideY, strideC, data.offset)
    } else if (isCanvasElement(data) || isOffscreenCanvas(data) || isContext2D(data)) {
      if (isCanvasElement(data) || isOffscreenCanvas(data)) {
        image.element = data
      } else {
        image.element = data.canvas
      }
      image.width = image.element.width
      image.height = image.element.height
      image.channels = 4
    } else if (isBitmap(data)) {
      image.element = data
      image.width = data.width
      image.height = data.height
      image.channels = 4
    } else if (isImageElement(data)) {
      image.element = data
      image.width = data.naturalWidth
      image.height = data.naturalHeight
      image.channels = 4
    } else if (isVideoElement(data)) {
      image.element = data
      image.width = data.videoWidth
      image.height = data.videoHeight
      image.channels = 4
    } else if (isRectArray(data)) {
      var w = image.width || data[0].length
      var h = image.height || data.length
      var c = image.channels
      if (isArrayLike(data[0][0])) {
        c = c || data[0][0].length
      } else {
        c = c || 1
      }
      var arrayShape = flattenUtils.shape(data)
      var n = 1
      for (var dd = 0; dd < arrayShape.length; ++dd) {
        n *= arrayShape[dd]
      }
      var allocData = preConvert(image, n)
      flattenUtils.flatten(data, arrayShape, '', allocData)
      postConvert(image, allocData)
      image.alignment = 1
      image.width = w
      image.height = h
      image.channels = c
      image.format = image.internalformat = CHANNELS_FORMAT[c]
      image.needsFree = true
    }

    if (image.type === GL_FLOAT$4) {
      check$1(limits.extensions.indexOf('oes_texture_float') >= 0,
        'oes_texture_float extension not enabled')
    } else if (image.type === GL_HALF_FLOAT_OES$1) {
      check$1(limits.extensions.indexOf('oes_texture_half_float') >= 0,
        'oes_texture_half_float extension not enabled')
    }

    // do compressed texture  validation here.
  }

  function setImage (info, target, miplevel) {
    var element = info.element
    var data = info.data
    var internalformat = info.internalformat
    var format = info.format
    var type = info.type
    var width = info.width
    var height = info.height

    setFlags(info)

    if (element) {
      gl.texImage2D(target, miplevel, format, format, type, element)
    } else if (info.compressed) {
      gl.compressedTexImage2D(target, miplevel, internalformat, width, height, 0, data)
    } else if (info.needsCopy) {
      reglPoll()
      gl.copyTexImage2D(
        target, miplevel, format, info.xOffset, info.yOffset, width, height, 0)
    } else {
      gl.texImage2D(target, miplevel, format, width, height, 0, format, type, data || null)
    }
  }

  function setSubImage (info, target, x, y, miplevel) {
    var element = info.element
    var data = info.data
    var internalformat = info.internalformat
    var format = info.format
    var type = info.type
    var width = info.width
    var height = info.height

    setFlags(info)

    if (element) {
      gl.texSubImage2D(
        target, miplevel, x, y, format, type, element)
    } else if (info.compressed) {
      gl.compressedTexSubImage2D(
        target, miplevel, x, y, internalformat, width, height, data)
    } else if (info.needsCopy) {
      reglPoll()
      gl.copyTexSubImage2D(
        target, miplevel, x, y, info.xOffset, info.yOffset, width, height)
    } else {
      gl.texSubImage2D(
        target, miplevel, x, y, width, height, format, type, data)
    }
  }

  // texImage pool
  var imagePool = []

  function allocImage () {
    return imagePool.pop() || new TexImage()
  }

  function freeImage (image) {
    if (image.needsFree) {
      pool.freeType(image.data)
    }
    TexImage.call(image)
    imagePool.push(image)
  }

  // -------------------------------------------------------
  // Mip map
  // -------------------------------------------------------
  function MipMap () {
    TexFlags.call(this)

    this.genMipmaps = false
    this.mipmapHint = GL_DONT_CARE
    this.mipmask = 0
    this.images = Array(16)
  }

  function parseMipMapFromShape (mipmap, width, height) {
    var img = mipmap.images[0] = allocImage()
    mipmap.mipmask = 1
    img.width = mipmap.width = width
    img.height = mipmap.height = height
    img.channels = mipmap.channels = 4
  }

  function parseMipMapFromObject (mipmap, options) {
    var imgData = null
    if (isPixelData(options)) {
      imgData = mipmap.images[0] = allocImage()
      copyFlags(imgData, mipmap)
      parseImage(imgData, options)
      mipmap.mipmask = 1
    } else {
      parseFlags(mipmap, options)
      if (Array.isArray(options.mipmap)) {
        var mipData = options.mipmap
        for (var i = 0; i < mipData.length; ++i) {
          imgData = mipmap.images[i] = allocImage()
          copyFlags(imgData, mipmap)
          imgData.width >>= i
          imgData.height >>= i
          parseImage(imgData, mipData[i])
          mipmap.mipmask |= (1 << i)
        }
      } else {
        imgData = mipmap.images[0] = allocImage()
        copyFlags(imgData, mipmap)
        parseImage(imgData, options)
        mipmap.mipmask = 1
      }
    }
    copyFlags(mipmap, mipmap.images[0])

    // For textures of the compressed format WEBGL_compressed_texture_s3tc
    // we must have that
    //
    // "When level equals zero width and height must be a multiple of 4.
    // When level is greater than 0 width and height must be 0, 1, 2 or a multiple of 4. "
    //
    // but we do not yet support having multiple mipmap levels for compressed textures,
    // so we only test for level zero.

    if (
      mipmap.compressed &&
      (
        mipmap.internalformat === GL_COMPRESSED_RGB_S3TC_DXT1_EXT ||
        mipmap.internalformat === GL_COMPRESSED_RGBA_S3TC_DXT1_EXT ||
        mipmap.internalformat === GL_COMPRESSED_RGBA_S3TC_DXT3_EXT ||
        mipmap.internalformat === GL_COMPRESSED_RGBA_S3TC_DXT5_EXT
      )
    ) {
      check$1(mipmap.width % 4 === 0 && mipmap.height % 4 === 0,
        'for compressed texture formats, mipmap level 0 must have width and height that are a multiple of 4')
    }
  }

  function setMipMap (mipmap, target) {
    var images = mipmap.images
    for (var i = 0; i < images.length; ++i) {
      if (!images[i]) {
        return
      }
      setImage(images[i], target, i)
    }
  }

  var mipPool = []

  function allocMipMap () {
    var result = mipPool.pop() || new MipMap()
    TexFlags.call(result)
    result.mipmask = 0
    for (var i = 0; i < 16; ++i) {
      result.images[i] = null
    }
    return result
  }

  function freeMipMap (mipmap) {
    var images = mipmap.images
    for (var i = 0; i < images.length; ++i) {
      if (images[i]) {
        freeImage(images[i])
      }
      images[i] = null
    }
    mipPool.push(mipmap)
  }

  // -------------------------------------------------------
  // Tex info
  // -------------------------------------------------------
  function TexInfo () {
    this.minFilter = GL_NEAREST$1
    this.magFilter = GL_NEAREST$1

    this.wrapS = GL_CLAMP_TO_EDGE$1
    this.wrapT = GL_CLAMP_TO_EDGE$1

    this.anisotropic = 1

    this.genMipmaps = false
    this.mipmapHint = GL_DONT_CARE
  }

  function parseTexInfo (info, options) {
    if ('min' in options) {
      var minFilter = options.min
      check$1.parameter(minFilter, minFilters)
      info.minFilter = minFilters[minFilter]
      if (MIPMAP_FILTERS.indexOf(info.minFilter) >= 0 && !('faces' in options)) {
        info.genMipmaps = true
      }
    }

    if ('mag' in options) {
      var magFilter = options.mag
      check$1.parameter(magFilter, magFilters)
      info.magFilter = magFilters[magFilter]
    }

    var wrapS = info.wrapS
    var wrapT = info.wrapT
    if ('wrap' in options) {
      var wrap = options.wrap
      if (typeof wrap === 'string') {
        check$1.parameter(wrap, wrapModes)
        wrapS = wrapT = wrapModes[wrap]
      } else if (Array.isArray(wrap)) {
        check$1.parameter(wrap[0], wrapModes)
        check$1.parameter(wrap[1], wrapModes)
        wrapS = wrapModes[wrap[0]]
        wrapT = wrapModes[wrap[1]]
      }
    } else {
      if ('wrapS' in options) {
        var optWrapS = options.wrapS
        check$1.parameter(optWrapS, wrapModes)
        wrapS = wrapModes[optWrapS]
      }
      if ('wrapT' in options) {
        var optWrapT = options.wrapT
        check$1.parameter(optWrapT, wrapModes)
        wrapT = wrapModes[optWrapT]
      }
    }
    info.wrapS = wrapS
    info.wrapT = wrapT

    if ('anisotropic' in options) {
      var anisotropic = options.anisotropic
      check$1(typeof anisotropic === 'number' &&
         anisotropic >= 1 && anisotropic <= limits.maxAnisotropic,
      'aniso samples must be between 1 and ')
      info.anisotropic = options.anisotropic
    }

    if ('mipmap' in options) {
      var hasMipMap = false
      switch (typeof options.mipmap) {
        case 'string':
          check$1.parameter(options.mipmap, mipmapHint,
            'invalid mipmap hint')
          info.mipmapHint = mipmapHint[options.mipmap]
          info.genMipmaps = true
          hasMipMap = true
          break

        case 'boolean':
          hasMipMap = info.genMipmaps = options.mipmap
          break

        case 'object':
          check$1(Array.isArray(options.mipmap), 'invalid mipmap type')
          info.genMipmaps = false
          hasMipMap = true
          break

        default:
          check$1.raise('invalid mipmap type')
      }
      if (hasMipMap && !('min' in options)) {
        info.minFilter = GL_NEAREST_MIPMAP_NEAREST$1
      }
    }
  }

  function setTexInfo (info, target) {
    gl.texParameteri(target, GL_TEXTURE_MIN_FILTER, info.minFilter)
    gl.texParameteri(target, GL_TEXTURE_MAG_FILTER, info.magFilter)
    gl.texParameteri(target, GL_TEXTURE_WRAP_S, info.wrapS)
    gl.texParameteri(target, GL_TEXTURE_WRAP_T, info.wrapT)
    if (extensions.ext_texture_filter_anisotropic) {
      gl.texParameteri(target, GL_TEXTURE_MAX_ANISOTROPY_EXT, info.anisotropic)
    }
    if (info.genMipmaps) {
      gl.hint(GL_GENERATE_MIPMAP_HINT, info.mipmapHint)
      gl.generateMipmap(target)
    }
  }

  // -------------------------------------------------------
  // Full texture object
  // -------------------------------------------------------
  var textureCount = 0
  var textureSet = {}
  var numTexUnits = limits.maxTextureUnits
  var textureUnits = Array(numTexUnits).map(function () {
    return null
  })

  function REGLTexture (target) {
    TexFlags.call(this)
    this.mipmask = 0
    this.internalformat = GL_RGBA$1

    this.id = textureCount++

    this.refCount = 1

    this.target = target
    this.texture = gl.createTexture()

    this.unit = -1
    this.bindCount = 0

    this.texInfo = new TexInfo()

    if (config.profile) {
      this.stats = { size: 0 }
    }
  }

  function tempBind (texture) {
    gl.activeTexture(GL_TEXTURE0$1)
    gl.bindTexture(texture.target, texture.texture)
  }

  function tempRestore () {
    var prev = textureUnits[0]
    if (prev) {
      gl.bindTexture(prev.target, prev.texture)
    } else {
      gl.bindTexture(GL_TEXTURE_2D$1, null)
    }
  }

  function destroy (texture) {
    var handle = texture.texture
    check$1(handle, 'must not double destroy texture')
    var unit = texture.unit
    var target = texture.target
    if (unit >= 0) {
      gl.activeTexture(GL_TEXTURE0$1 + unit)
      gl.bindTexture(target, null)
      textureUnits[unit] = null
    }
    gl.deleteTexture(handle)
    texture.texture = null
    texture.params = null
    texture.pixels = null
    texture.refCount = 0
    delete textureSet[texture.id]
    stats.textureCount--
  }

  extend(REGLTexture.prototype, {
    bind: function () {
      var texture = this
      texture.bindCount += 1
      var unit = texture.unit
      if (unit < 0) {
        for (var i = 0; i < numTexUnits; ++i) {
          var other = textureUnits[i]
          if (other) {
            if (other.bindCount > 0) {
              continue
            }
            other.unit = -1
          }
          textureUnits[i] = texture
          unit = i
          break
        }
        if (unit >= numTexUnits) {
          check$1.raise('insufficient number of texture units')
        }
        if (config.profile && stats.maxTextureUnits < (unit + 1)) {
          stats.maxTextureUnits = unit + 1 // +1, since the units are zero-based
        }
        texture.unit = unit
        gl.activeTexture(GL_TEXTURE0$1 + unit)
        gl.bindTexture(texture.target, texture.texture)
      }
      return unit
    },

    unbind: function () {
      this.bindCount -= 1
    },

    decRef: function () {
      if (--this.refCount <= 0) {
        destroy(this)
      }
    }
  })

  function createTexture2D (a, b) {
    var texture = new REGLTexture(GL_TEXTURE_2D$1)
    textureSet[texture.id] = texture
    stats.textureCount++

    function reglTexture2D (a, b) {
      var texInfo = texture.texInfo
      TexInfo.call(texInfo)
      var mipData = allocMipMap()

      if (typeof a === 'number') {
        if (typeof b === 'number') {
          parseMipMapFromShape(mipData, a | 0, b | 0)
        } else {
          parseMipMapFromShape(mipData, a | 0, a | 0)
        }
      } else if (a) {
        check$1.type(a, 'object', 'invalid arguments to regl.texture')
        parseTexInfo(texInfo, a)
        parseMipMapFromObject(mipData, a)
      } else {
        // empty textures get assigned a default shape of 1x1
        parseMipMapFromShape(mipData, 1, 1)
      }

      if (texInfo.genMipmaps) {
        mipData.mipmask = (mipData.width << 1) - 1
      }
      texture.mipmask = mipData.mipmask

      copyFlags(texture, mipData)

      check$1.texture2D(texInfo, mipData, limits)
      texture.internalformat = mipData.internalformat

      reglTexture2D.width = mipData.width
      reglTexture2D.height = mipData.height

      tempBind(texture)
      setMipMap(mipData, GL_TEXTURE_2D$1)
      setTexInfo(texInfo, GL_TEXTURE_2D$1)
      tempRestore()

      freeMipMap(mipData)

      if (config.profile) {
        texture.stats.size = getTextureSize(
          texture.internalformat,
          texture.type,
          mipData.width,
          mipData.height,
          texInfo.genMipmaps,
          false)
      }
      reglTexture2D.format = textureFormatsInvert[texture.internalformat]
      reglTexture2D.type = textureTypesInvert[texture.type]

      reglTexture2D.mag = magFiltersInvert[texInfo.magFilter]
      reglTexture2D.min = minFiltersInvert[texInfo.minFilter]

      reglTexture2D.wrapS = wrapModesInvert[texInfo.wrapS]
      reglTexture2D.wrapT = wrapModesInvert[texInfo.wrapT]

      return reglTexture2D
    }

    function subimage (image, x_, y_, level_) {
      check$1(!!image, 'must specify image data')

      var x = x_ | 0
      var y = y_ | 0
      var level = level_ | 0

      var imageData = allocImage()
      copyFlags(imageData, texture)
      imageData.width = 0
      imageData.height = 0
      parseImage(imageData, image)
      imageData.width = imageData.width || ((texture.width >> level) - x)
      imageData.height = imageData.height || ((texture.height >> level) - y)

      check$1(
        texture.type === imageData.type &&
        texture.format === imageData.format &&
        texture.internalformat === imageData.internalformat,
        'incompatible format for texture.subimage')
      check$1(
        x >= 0 && y >= 0 &&
        x + imageData.width <= texture.width &&
        y + imageData.height <= texture.height,
        'texture.subimage write out of bounds')
      check$1(
        texture.mipmask & (1 << level),
        'missing mipmap data')
      check$1(
        imageData.data || imageData.element || imageData.needsCopy,
        'missing image data')

      tempBind(texture)
      setSubImage(imageData, GL_TEXTURE_2D$1, x, y, level)
      tempRestore()

      freeImage(imageData)

      return reglTexture2D
    }

    function resize (w_, h_) {
      var w = w_ | 0
      var h = (h_ | 0) || w
      if (w === texture.width && h === texture.height) {
        return reglTexture2D
      }

      reglTexture2D.width = texture.width = w
      reglTexture2D.height = texture.height = h

      tempBind(texture)

      for (var i = 0; texture.mipmask >> i; ++i) {
        var _w = w >> i
        var _h = h >> i
        if (!_w || !_h) break
        gl.texImage2D(
          GL_TEXTURE_2D$1,
          i,
          texture.format,
          _w,
          _h,
          0,
          texture.format,
          texture.type,
          null)
      }
      tempRestore()

      // also, recompute the texture size.
      if (config.profile) {
        texture.stats.size = getTextureSize(
          texture.internalformat,
          texture.type,
          w,
          h,
          false,
          false)
      }

      return reglTexture2D
    }

    reglTexture2D(a, b)

    reglTexture2D.subimage = subimage
    reglTexture2D.resize = resize
    reglTexture2D._reglType = 'texture2d'
    reglTexture2D._texture = texture
    if (config.profile) {
      reglTexture2D.stats = texture.stats
    }
    reglTexture2D.destroy = function () {
      texture.decRef()
    }

    return reglTexture2D
  }

  function createTextureCube (a0, a1, a2, a3, a4, a5) {
    var texture = new REGLTexture(GL_TEXTURE_CUBE_MAP$1)
    textureSet[texture.id] = texture
    stats.cubeCount++

    var faces = new Array(6)

    function reglTextureCube (a0, a1, a2, a3, a4, a5) {
      var i
      var texInfo = texture.texInfo
      TexInfo.call(texInfo)
      for (i = 0; i < 6; ++i) {
        faces[i] = allocMipMap()
      }

      if (typeof a0 === 'number' || !a0) {
        var s = (a0 | 0) || 1
        for (i = 0; i < 6; ++i) {
          parseMipMapFromShape(faces[i], s, s)
        }
      } else if (typeof a0 === 'object') {
        if (a1) {
          parseMipMapFromObject(faces[0], a0)
          parseMipMapFromObject(faces[1], a1)
          parseMipMapFromObject(faces[2], a2)
          parseMipMapFromObject(faces[3], a3)
          parseMipMapFromObject(faces[4], a4)
          parseMipMapFromObject(faces[5], a5)
        } else {
          parseTexInfo(texInfo, a0)
          parseFlags(texture, a0)
          if ('faces' in a0) {
            var faceInput = a0.faces
            check$1(Array.isArray(faceInput) && faceInput.length === 6,
              'cube faces must be a length 6 array')
            for (i = 0; i < 6; ++i) {
              check$1(typeof faceInput[i] === 'object' && !!faceInput[i],
                'invalid input for cube map face')
              copyFlags(faces[i], texture)
              parseMipMapFromObject(faces[i], faceInput[i])
            }
          } else {
            for (i = 0; i < 6; ++i) {
              parseMipMapFromObject(faces[i], a0)
            }
          }
        }
      } else {
        check$1.raise('invalid arguments to cube map')
      }

      copyFlags(texture, faces[0])
      check$1.optional(function () {
        if (!limits.npotTextureCube) {
          check$1(isPow2$1(texture.width) && isPow2$1(texture.height), 'your browser does not support non power or two texture dimensions')
        }
      })

      if (texInfo.genMipmaps) {
        texture.mipmask = (faces[0].width << 1) - 1
      } else {
        texture.mipmask = faces[0].mipmask
      }

      check$1.textureCube(texture, texInfo, faces, limits)
      texture.internalformat = faces[0].internalformat

      reglTextureCube.width = faces[0].width
      reglTextureCube.height = faces[0].height

      tempBind(texture)
      for (i = 0; i < 6; ++i) {
        setMipMap(faces[i], GL_TEXTURE_CUBE_MAP_POSITIVE_X$1 + i)
      }
      setTexInfo(texInfo, GL_TEXTURE_CUBE_MAP$1)
      tempRestore()

      if (config.profile) {
        texture.stats.size = getTextureSize(
          texture.internalformat,
          texture.type,
          reglTextureCube.width,
          reglTextureCube.height,
          texInfo.genMipmaps,
          true)
      }

      reglTextureCube.format = textureFormatsInvert[texture.internalformat]
      reglTextureCube.type = textureTypesInvert[texture.type]

      reglTextureCube.mag = magFiltersInvert[texInfo.magFilter]
      reglTextureCube.min = minFiltersInvert[texInfo.minFilter]

      reglTextureCube.wrapS = wrapModesInvert[texInfo.wrapS]
      reglTextureCube.wrapT = wrapModesInvert[texInfo.wrapT]

      for (i = 0; i < 6; ++i) {
        freeMipMap(faces[i])
      }

      return reglTextureCube
    }

    function subimage (face, image, x_, y_, level_) {
      check$1(!!image, 'must specify image data')
      check$1(typeof face === 'number' && face === (face | 0) &&
        face >= 0 && face < 6, 'invalid face')

      var x = x_ | 0
      var y = y_ | 0
      var level = level_ | 0

      var imageData = allocImage()
      copyFlags(imageData, texture)
      imageData.width = 0
      imageData.height = 0
      parseImage(imageData, image)
      imageData.width = imageData.width || ((texture.width >> level) - x)
      imageData.height = imageData.height || ((texture.height >> level) - y)

      check$1(
        texture.type === imageData.type &&
        texture.format === imageData.format &&
        texture.internalformat === imageData.internalformat,
        'incompatible format for texture.subimage')
      check$1(
        x >= 0 && y >= 0 &&
        x + imageData.width <= texture.width &&
        y + imageData.height <= texture.height,
        'texture.subimage write out of bounds')
      check$1(
        texture.mipmask & (1 << level),
        'missing mipmap data')
      check$1(
        imageData.data || imageData.element || imageData.needsCopy,
        'missing image data')

      tempBind(texture)
      setSubImage(imageData, GL_TEXTURE_CUBE_MAP_POSITIVE_X$1 + face, x, y, level)
      tempRestore()

      freeImage(imageData)

      return reglTextureCube
    }

    function resize (radius_) {
      var radius = radius_ | 0
      if (radius === texture.width) {
        return
      }

      reglTextureCube.width = texture.width = radius
      reglTextureCube.height = texture.height = radius

      tempBind(texture)
      for (var i = 0; i < 6; ++i) {
        for (var j = 0; texture.mipmask >> j; ++j) {
          gl.texImage2D(
            GL_TEXTURE_CUBE_MAP_POSITIVE_X$1 + i,
            j,
            texture.format,
            radius >> j,
            radius >> j,
            0,
            texture.format,
            texture.type,
            null)
        }
      }
      tempRestore()

      if (config.profile) {
        texture.stats.size = getTextureSize(
          texture.internalformat,
          texture.type,
          reglTextureCube.width,
          reglTextureCube.height,
          false,
          true)
      }

      return reglTextureCube
    }

    reglTextureCube(a0, a1, a2, a3, a4, a5)

    reglTextureCube.subimage = subimage
    reglTextureCube.resize = resize
    reglTextureCube._reglType = 'textureCube'
    reglTextureCube._texture = texture
    if (config.profile) {
      reglTextureCube.stats = texture.stats
    }
    reglTextureCube.destroy = function () {
      texture.decRef()
    }

    return reglTextureCube
  }

  // Called when regl is destroyed
  function destroyTextures () {
    for (var i = 0; i < numTexUnits; ++i) {
      gl.activeTexture(GL_TEXTURE0$1 + i)
      gl.bindTexture(GL_TEXTURE_2D$1, null)
      textureUnits[i] = null
    }
    values(textureSet).forEach(destroy)

    stats.cubeCount = 0
    stats.textureCount = 0
  }

  if (config.profile) {
    stats.getTotalTextureSize = function () {
      var total = 0
      sortedObjectKeys(textureSet).forEach(function (key) {
        total += textureSet[key].stats.size
      })
      return total
    }
  }

  function restoreTextures () {
    for (var i = 0; i < numTexUnits; ++i) {
      var tex = textureUnits[i]
      if (tex) {
        tex.bindCount = 0
        tex.unit = -1
        textureUnits[i] = null
      }
    }

    values(textureSet).forEach(function (texture) {
      texture.texture = gl.createTexture()
      gl.bindTexture(texture.target, texture.texture)
      for (var i = 0; i < 32; ++i) {
        if ((texture.mipmask & (1 << i)) === 0) {
          continue
        }
        if (texture.target === GL_TEXTURE_2D$1) {
          gl.texImage2D(GL_TEXTURE_2D$1,
            i,
            texture.internalformat,
            texture.width >> i,
            texture.height >> i,
            0,
            texture.internalformat,
            texture.type,
            null)
        } else {
          for (var j = 0; j < 6; ++j) {
            gl.texImage2D(GL_TEXTURE_CUBE_MAP_POSITIVE_X$1 + j,
              i,
              texture.internalformat,
              texture.width >> i,
              texture.height >> i,
              0,
              texture.internalformat,
              texture.type,
              null)
          }
        }
      }
      setTexInfo(texture.texInfo, texture.target)
    })
  }

  function refreshTextures () {
    for (var i = 0; i < numTexUnits; ++i) {
      var tex = textureUnits[i]
      if (tex) {
        tex.bindCount = 0
        tex.unit = -1
        textureUnits[i] = null
      }
      gl.activeTexture(GL_TEXTURE0$1 + i)
      gl.bindTexture(GL_TEXTURE_2D$1, null)
      gl.bindTexture(GL_TEXTURE_CUBE_MAP$1, null)
    }
  }

  return {
    create2D: createTexture2D,
    createCube: createTextureCube,
    clear: destroyTextures,
    getTexture: function (wrapper) {
      return null
    },
    restore: restoreTextures,
    refresh: refreshTextures
  }
}

var GL_RENDERBUFFER = 0x8D41

var GL_RGBA4$1 = 0x8056
var GL_RGB5_A1$1 = 0x8057
var GL_RGB565$1 = 0x8D62
var GL_DEPTH_COMPONENT16 = 0x81A5
var GL_STENCIL_INDEX8 = 0x8D48
var GL_DEPTH_STENCIL$1 = 0x84F9

var GL_SRGB8_ALPHA8_EXT = 0x8C43

var GL_RGBA32F_EXT = 0x8814

var GL_RGBA16F_EXT = 0x881A
var GL_RGB16F_EXT = 0x881B

var FORMAT_SIZES = []

FORMAT_SIZES[GL_RGBA4$1] = 2
FORMAT_SIZES[GL_RGB5_A1$1] = 2
FORMAT_SIZES[GL_RGB565$1] = 2

FORMAT_SIZES[GL_DEPTH_COMPONENT16] = 2
FORMAT_SIZES[GL_STENCIL_INDEX8] = 1
FORMAT_SIZES[GL_DEPTH_STENCIL$1] = 4

FORMAT_SIZES[GL_SRGB8_ALPHA8_EXT] = 4
FORMAT_SIZES[GL_RGBA32F_EXT] = 16
FORMAT_SIZES[GL_RGBA16F_EXT] = 8
FORMAT_SIZES[GL_RGB16F_EXT] = 6

function getRenderbufferSize (format, width, height) {
  return FORMAT_SIZES[format] * width * height
}

var wrapRenderbuffers = function (gl, extensions, limits, stats, config) {
  var formatTypes = {
    'rgba4': GL_RGBA4$1,
    'rgb565': GL_RGB565$1,
    'rgb5 a1': GL_RGB5_A1$1,
    'depth': GL_DEPTH_COMPONENT16,
    'stencil': GL_STENCIL_INDEX8,
    'depth stencil': GL_DEPTH_STENCIL$1
  }

  if (extensions.ext_srgb) {
    formatTypes['srgba'] = GL_SRGB8_ALPHA8_EXT
  }

  if (extensions.ext_color_buffer_half_float) {
    formatTypes['rgba16f'] = GL_RGBA16F_EXT
    formatTypes['rgb16f'] = GL_RGB16F_EXT
  }

  if (extensions.webgl_color_buffer_float) {
    formatTypes['rgba32f'] = GL_RGBA32F_EXT
  }

  var formatTypesInvert = []
  sortedObjectKeys(formatTypes).forEach(function (key) {
    var val = formatTypes[key]
    formatTypesInvert[val] = key
  })

  var renderbufferCount = 0
  var renderbufferSet = {}

  function REGLRenderbuffer (renderbuffer) {
    this.id = renderbufferCount++
    this.refCount = 1

    this.renderbuffer = renderbuffer

    this.format = GL_RGBA4$1
    this.width = 0
    this.height = 0

    if (config.profile) {
      this.stats = { size: 0 }
    }
  }

  REGLRenderbuffer.prototype.decRef = function () {
    if (--this.refCount <= 0) {
      destroy(this)
    }
  }

  function destroy (rb) {
    var handle = rb.renderbuffer
    check$1(handle, 'must not double destroy renderbuffer')
    gl.bindRenderbuffer(GL_RENDERBUFFER, null)
    gl.deleteRenderbuffer(handle)
    rb.renderbuffer = null
    rb.refCount = 0
    delete renderbufferSet[rb.id]
    stats.renderbufferCount--
  }

  function createRenderbuffer (a, b) {
    var renderbuffer = new REGLRenderbuffer(gl.createRenderbuffer())
    renderbufferSet[renderbuffer.id] = renderbuffer
    stats.renderbufferCount++

    function reglRenderbuffer (a, b) {
      var w = 0
      var h = 0
      var format = GL_RGBA4$1

      if (typeof a === 'object' && a) {
        var options = a
        if ('shape' in options) {
          var shape = options.shape
          check$1(Array.isArray(shape) && shape.length >= 2,
            'invalid renderbuffer shape')
          w = shape[0] | 0
          h = shape[1] | 0
        } else {
          if ('radius' in options) {
            w = h = options.radius | 0
          }
          if ('width' in options) {
            w = options.width | 0
          }
          if ('height' in options) {
            h = options.height | 0
          }
        }
        if ('format' in options) {
          check$1.parameter(options.format, formatTypes,
            'invalid renderbuffer format')
          format = formatTypes[options.format]
        }
      } else if (typeof a === 'number') {
        w = a | 0
        if (typeof b === 'number') {
          h = b | 0
        } else {
          h = w
        }
      } else if (!a) {
        w = h = 1
      } else {
        check$1.raise('invalid arguments to renderbuffer constructor')
      }

      // check shape
      check$1(
        w > 0 && h > 0 &&
        w <= limits.maxRenderbufferSize && h <= limits.maxRenderbufferSize,
        'invalid renderbuffer size')

      if (w === renderbuffer.width &&
          h === renderbuffer.height &&
          format === renderbuffer.format) {
        return
      }

      reglRenderbuffer.width = renderbuffer.width = w
      reglRenderbuffer.height = renderbuffer.height = h
      renderbuffer.format = format

      gl.bindRenderbuffer(GL_RENDERBUFFER, renderbuffer.renderbuffer)
      gl.renderbufferStorage(GL_RENDERBUFFER, format, w, h)

      check$1(
        gl.getError() === 0,
        'invalid render buffer format')

      if (config.profile) {
        renderbuffer.stats.size = getRenderbufferSize(renderbuffer.format, renderbuffer.width, renderbuffer.height)
      }
      reglRenderbuffer.format = formatTypesInvert[renderbuffer.format]

      return reglRenderbuffer
    }

    function resize (w_, h_) {
      var w = w_ | 0
      var h = (h_ | 0) || w

      if (w === renderbuffer.width && h === renderbuffer.height) {
        return reglRenderbuffer
      }

      // check shape
      check$1(
        w > 0 && h > 0 &&
        w <= limits.maxRenderbufferSize && h <= limits.maxRenderbufferSize,
        'invalid renderbuffer size')

      reglRenderbuffer.width = renderbuffer.width = w
      reglRenderbuffer.height = renderbuffer.height = h

      gl.bindRenderbuffer(GL_RENDERBUFFER, renderbuffer.renderbuffer)
      gl.renderbufferStorage(GL_RENDERBUFFER, renderbuffer.format, w, h)

      check$1(
        gl.getError() === 0,
        'invalid render buffer format')

      // also, recompute size.
      if (config.profile) {
        renderbuffer.stats.size = getRenderbufferSize(
          renderbuffer.format, renderbuffer.width, renderbuffer.height)
      }

      return reglRenderbuffer
    }

    reglRenderbuffer(a, b)

    reglRenderbuffer.resize = resize
    reglRenderbuffer._reglType = 'renderbuffer'
    reglRenderbuffer._renderbuffer = renderbuffer
    if (config.profile) {
      reglRenderbuffer.stats = renderbuffer.stats
    }
    reglRenderbuffer.destroy = function () {
      renderbuffer.decRef()
    }

    return reglRenderbuffer
  }

  if (config.profile) {
    stats.getTotalRenderbufferSize = function () {
      var total = 0
      sortedObjectKeys(renderbufferSet).forEach(function (key) {
        total += renderbufferSet[key].stats.size
      })
      return total
    }
  }

  function restoreRenderbuffers () {
    values(renderbufferSet).forEach(function (rb) {
      rb.renderbuffer = gl.createRenderbuffer()
      gl.bindRenderbuffer(GL_RENDERBUFFER, rb.renderbuffer)
      gl.renderbufferStorage(GL_RENDERBUFFER, rb.format, rb.width, rb.height)
    })
    gl.bindRenderbuffer(GL_RENDERBUFFER, null)
  }

  return {
    create: createRenderbuffer,
    clear: function () {
      values(renderbufferSet).forEach(destroy)
    },
    restore: restoreRenderbuffers
  }
}

// We store these constants so that the minifier can inline them
var GL_FRAMEBUFFER$1 = 0x8D40
var GL_RENDERBUFFER$1 = 0x8D41

var GL_TEXTURE_2D$2 = 0x0DE1
var GL_TEXTURE_CUBE_MAP_POSITIVE_X$2 = 0x8515

var GL_COLOR_ATTACHMENT0$1 = 0x8CE0
var GL_DEPTH_ATTACHMENT = 0x8D00
var GL_STENCIL_ATTACHMENT = 0x8D20
var GL_DEPTH_STENCIL_ATTACHMENT = 0x821A

var GL_FRAMEBUFFER_COMPLETE$1 = 0x8CD5
var GL_FRAMEBUFFER_INCOMPLETE_ATTACHMENT = 0x8CD6
var GL_FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT = 0x8CD7
var GL_FRAMEBUFFER_INCOMPLETE_DIMENSIONS = 0x8CD9
var GL_FRAMEBUFFER_UNSUPPORTED = 0x8CDD

var GL_HALF_FLOAT_OES$2 = 0x8D61
var GL_UNSIGNED_BYTE$6 = 0x1401
var GL_FLOAT$5 = 0x1406

var GL_RGB$1 = 0x1907
var GL_RGBA$2 = 0x1908

var GL_DEPTH_COMPONENT$1 = 0x1902

var colorTextureFormatEnums = [
  GL_RGB$1,
  GL_RGBA$2
]

// for every texture format, store
// the number of channels
var textureFormatChannels = []
textureFormatChannels[GL_RGBA$2] = 4
textureFormatChannels[GL_RGB$1] = 3

// for every texture type, store
// the size in bytes.
var textureTypeSizes = []
textureTypeSizes[GL_UNSIGNED_BYTE$6] = 1
textureTypeSizes[GL_FLOAT$5] = 4
textureTypeSizes[GL_HALF_FLOAT_OES$2] = 2

var GL_RGBA4$2 = 0x8056
var GL_RGB5_A1$2 = 0x8057
var GL_RGB565$2 = 0x8D62
var GL_DEPTH_COMPONENT16$1 = 0x81A5
var GL_STENCIL_INDEX8$1 = 0x8D48
var GL_DEPTH_STENCIL$2 = 0x84F9

var GL_SRGB8_ALPHA8_EXT$1 = 0x8C43

var GL_RGBA32F_EXT$1 = 0x8814

var GL_RGBA16F_EXT$1 = 0x881A
var GL_RGB16F_EXT$1 = 0x881B

var colorRenderbufferFormatEnums = [
  GL_RGBA4$2,
  GL_RGB5_A1$2,
  GL_RGB565$2,
  GL_SRGB8_ALPHA8_EXT$1,
  GL_RGBA16F_EXT$1,
  GL_RGB16F_EXT$1,
  GL_RGBA32F_EXT$1
]

var statusCode = {}
statusCode[GL_FRAMEBUFFER_COMPLETE$1] = 'complete'
statusCode[GL_FRAMEBUFFER_INCOMPLETE_ATTACHMENT] = 'incomplete attachment'
statusCode[GL_FRAMEBUFFER_INCOMPLETE_DIMENSIONS] = 'incomplete dimensions'
statusCode[GL_FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT] = 'incomplete, missing attachment'
statusCode[GL_FRAMEBUFFER_UNSUPPORTED] = 'unsupported'

function wrapFBOState (
  gl,
  extensions,
  limits,
  textureState,
  renderbufferState,
  stats) {
  var framebufferState = {
    cur: null,
    next: null,
    dirty: false,
    setFBO: null
  }

  var colorTextureFormats = ['rgba']
  var colorRenderbufferFormats = ['rgba4', 'rgb565', 'rgb5 a1']

  if (extensions.ext_srgb) {
    colorRenderbufferFormats.push('srgba')
  }

  if (extensions.ext_color_buffer_half_float) {
    colorRenderbufferFormats.push('rgba16f', 'rgb16f')
  }

  if (extensions.webgl_color_buffer_float) {
    colorRenderbufferFormats.push('rgba32f')
  }

  var colorTypes = ['uint8']
  if (extensions.oes_texture_half_float) {
    colorTypes.push('half float', 'float16')
  }
  if (extensions.oes_texture_float) {
    colorTypes.push('float', 'float32')
  }

  function FramebufferAttachment (target, texture, renderbuffer) {
    this.target = target
    this.texture = texture
    this.renderbuffer = renderbuffer

    var w = 0
    var h = 0
    if (texture) {
      w = texture.width
      h = texture.height
    } else if (renderbuffer) {
      w = renderbuffer.width
      h = renderbuffer.height
    }
    this.width = w
    this.height = h
  }

  function decRef (attachment) {
    if (attachment) {
      if (attachment.texture) {
        attachment.texture._texture.decRef()
      }
      if (attachment.renderbuffer) {
        attachment.renderbuffer._renderbuffer.decRef()
      }
    }
  }

  function incRefAndCheckShape (attachment, width, height) {
    if (!attachment) {
      return
    }
    if (attachment.texture) {
      var texture = attachment.texture._texture
      var tw = Math.max(1, texture.width)
      var th = Math.max(1, texture.height)
      check$1(tw === width && th === height,
        'inconsistent width/height for supplied texture')
      texture.refCount += 1
    } else {
      var renderbuffer = attachment.renderbuffer._renderbuffer
      check$1(
        renderbuffer.width === width && renderbuffer.height === height,
        'inconsistent width/height for renderbuffer')
      renderbuffer.refCount += 1
    }
  }

  function attach (location, attachment) {
    if (attachment) {
      if (attachment.texture) {
        gl.framebufferTexture2D(
          GL_FRAMEBUFFER$1,
          location,
          attachment.target,
          attachment.texture._texture.texture,
          0)
      } else {
        gl.framebufferRenderbuffer(
          GL_FRAMEBUFFER$1,
          location,
          GL_RENDERBUFFER$1,
          attachment.renderbuffer._renderbuffer.renderbuffer)
      }
    }
  }

  function parseAttachment (attachment) {
    var target = GL_TEXTURE_2D$2
    var texture = null
    var renderbuffer = null

    var data = attachment
    if (typeof attachment === 'object') {
      data = attachment.data
      if ('target' in attachment) {
        target = attachment.target | 0
      }
    }

    check$1.type(data, 'function', 'invalid attachment data')

    var type = data._reglType
    if (type === 'texture2d') {
      texture = data
      check$1(target === GL_TEXTURE_2D$2)
    } else if (type === 'textureCube') {
      texture = data
      check$1(
        target >= GL_TEXTURE_CUBE_MAP_POSITIVE_X$2 &&
        target < GL_TEXTURE_CUBE_MAP_POSITIVE_X$2 + 6,
        'invalid cube map target')
    } else if (type === 'renderbuffer') {
      renderbuffer = data
      target = GL_RENDERBUFFER$1
    } else {
      check$1.raise('invalid regl object for attachment')
    }

    return new FramebufferAttachment(target, texture, renderbuffer)
  }

  function allocAttachment (
    width,
    height,
    isTexture,
    format,
    type) {
    if (isTexture) {
      var texture = textureState.create2D({
        width: width,
        height: height,
        format: format,
        type: type
      })
      texture._texture.refCount = 0
      return new FramebufferAttachment(GL_TEXTURE_2D$2, texture, null)
    } else {
      var rb = renderbufferState.create({
        width: width,
        height: height,
        format: format
      })
      rb._renderbuffer.refCount = 0
      return new FramebufferAttachment(GL_RENDERBUFFER$1, null, rb)
    }
  }

  function unwrapAttachment (attachment) {
    return attachment && (attachment.texture || attachment.renderbuffer)
  }

  function resizeAttachment (attachment, w, h) {
    if (attachment) {
      if (attachment.texture) {
        attachment.texture.resize(w, h)
      } else if (attachment.renderbuffer) {
        attachment.renderbuffer.resize(w, h)
      }
      attachment.width = w
      attachment.height = h
    }
  }

  var framebufferCount = 0
  var framebufferSet = {}

  function REGLFramebuffer () {
    this.id = framebufferCount++
    framebufferSet[this.id] = this

    this.framebuffer = gl.createFramebuffer()
    this.width = 0
    this.height = 0

    this.colorAttachments = []
    this.depthAttachment = null
    this.stencilAttachment = null
    this.depthStencilAttachment = null
  }

  function decFBORefs (framebuffer) {
    framebuffer.colorAttachments.forEach(decRef)
    decRef(framebuffer.depthAttachment)
    decRef(framebuffer.stencilAttachment)
    decRef(framebuffer.depthStencilAttachment)
  }

  function destroy (framebuffer) {
    var handle = framebuffer.framebuffer
    check$1(handle, 'must not double destroy framebuffer')
    gl.deleteFramebuffer(handle)
    framebuffer.framebuffer = null
    stats.framebufferCount--
    delete framebufferSet[framebuffer.id]
  }

  function updateFramebuffer (framebuffer) {
    var i

    gl.bindFramebuffer(GL_FRAMEBUFFER$1, framebuffer.framebuffer)
    var colorAttachments = framebuffer.colorAttachments
    for (i = 0; i < colorAttachments.length; ++i) {
      attach(GL_COLOR_ATTACHMENT0$1 + i, colorAttachments[i])
    }
    for (i = colorAttachments.length; i < limits.maxColorAttachments; ++i) {
      gl.framebufferTexture2D(
        GL_FRAMEBUFFER$1,
        GL_COLOR_ATTACHMENT0$1 + i,
        GL_TEXTURE_2D$2,
        null,
        0)
    }

    gl.framebufferTexture2D(
      GL_FRAMEBUFFER$1,
      GL_DEPTH_STENCIL_ATTACHMENT,
      GL_TEXTURE_2D$2,
      null,
      0)
    gl.framebufferTexture2D(
      GL_FRAMEBUFFER$1,
      GL_DEPTH_ATTACHMENT,
      GL_TEXTURE_2D$2,
      null,
      0)
    gl.framebufferTexture2D(
      GL_FRAMEBUFFER$1,
      GL_STENCIL_ATTACHMENT,
      GL_TEXTURE_2D$2,
      null,
      0)

    attach(GL_DEPTH_ATTACHMENT, framebuffer.depthAttachment)
    attach(GL_STENCIL_ATTACHMENT, framebuffer.stencilAttachment)
    attach(GL_DEPTH_STENCIL_ATTACHMENT, framebuffer.depthStencilAttachment)

    // Check status code
    var status = gl.checkFramebufferStatus(GL_FRAMEBUFFER$1)
    if (!gl.isContextLost() && status !== GL_FRAMEBUFFER_COMPLETE$1) {
      check$1.raise('framebuffer configuration not supported, status = ' +
        statusCode[status])
    }

    gl.bindFramebuffer(GL_FRAMEBUFFER$1, framebufferState.next ? framebufferState.next.framebuffer : null)
    framebufferState.cur = framebufferState.next

    // FIXME: Clear error code here.  This is a work around for a bug in
    // headless-gl
    gl.getError()
  }

  function createFBO (a0, a1) {
    var framebuffer = new REGLFramebuffer()
    stats.framebufferCount++

    function reglFramebuffer (a, b) {
      var i

      check$1(framebufferState.next !== framebuffer,
        'can not update framebuffer which is currently in use')

      var width = 0
      var height = 0

      var needsDepth = true
      var needsStencil = true

      var colorBuffer = null
      var colorTexture = true
      var colorFormat = 'rgba'
      var colorType = 'uint8'
      var colorCount = 1

      var depthBuffer = null
      var stencilBuffer = null
      var depthStencilBuffer = null
      var depthStencilTexture = false

      if (typeof a === 'number') {
        width = a | 0
        height = (b | 0) || width
      } else if (!a) {
        width = height = 1
      } else {
        check$1.type(a, 'object', 'invalid arguments for framebuffer')
        var options = a

        if ('shape' in options) {
          var shape = options.shape
          check$1(Array.isArray(shape) && shape.length >= 2,
            'invalid shape for framebuffer')
          width = shape[0]
          height = shape[1]
        } else {
          if ('radius' in options) {
            width = height = options.radius
          }
          if ('width' in options) {
            width = options.width
          }
          if ('height' in options) {
            height = options.height
          }
        }

        if ('color' in options ||
            'colors' in options) {
          colorBuffer =
            options.color ||
            options.colors
          if (Array.isArray(colorBuffer)) {
            check$1(
              colorBuffer.length === 1 || extensions.webgl_draw_buffers,
              'multiple render targets not supported')
          }
        }

        if (!colorBuffer) {
          if ('colorCount' in options) {
            colorCount = options.colorCount | 0
            check$1(colorCount > 0, 'invalid color buffer count')
          }

          if ('colorTexture' in options) {
            colorTexture = !!options.colorTexture
            colorFormat = 'rgba4'
          }

          if ('colorType' in options) {
            colorType = options.colorType
            if (!colorTexture) {
              if (colorType === 'half float' || colorType === 'float16') {
                check$1(extensions.ext_color_buffer_half_float,
                  'you must enable EXT_color_buffer_half_float to use 16-bit render buffers')
                colorFormat = 'rgba16f'
              } else if (colorType === 'float' || colorType === 'float32') {
                check$1(extensions.webgl_color_buffer_float,
                  'you must enable WEBGL_color_buffer_float in order to use 32-bit floating point renderbuffers')
                colorFormat = 'rgba32f'
              }
            } else {
              check$1(extensions.oes_texture_float ||
                !(colorType === 'float' || colorType === 'float32'),
              'you must enable OES_texture_float in order to use floating point framebuffer objects')
              check$1(extensions.oes_texture_half_float ||
                !(colorType === 'half float' || colorType === 'float16'),
              'you must enable OES_texture_half_float in order to use 16-bit floating point framebuffer objects')
            }
            check$1.oneOf(colorType, colorTypes, 'invalid color type')
          }

          if ('colorFormat' in options) {
            colorFormat = options.colorFormat
            if (colorTextureFormats.indexOf(colorFormat) >= 0) {
              colorTexture = true
            } else if (colorRenderbufferFormats.indexOf(colorFormat) >= 0) {
              colorTexture = false
            } else {
              check$1.optional(function () {
                if (colorTexture) {
                  check$1.oneOf(
                    options.colorFormat, colorTextureFormats,
                    'invalid color format for texture')
                } else {
                  check$1.oneOf(
                    options.colorFormat, colorRenderbufferFormats,
                    'invalid color format for renderbuffer')
                }
              })
            }
          }
        }

        if ('depthTexture' in options || 'depthStencilTexture' in options) {
          depthStencilTexture = !!(options.depthTexture ||
            options.depthStencilTexture)
          check$1(!depthStencilTexture || extensions.webgl_depth_texture,
            'webgl_depth_texture extension not supported')
        }

        if ('depth' in options) {
          if (typeof options.depth === 'boolean') {
            needsDepth = options.depth
          } else {
            depthBuffer = options.depth
            needsStencil = false
          }
        }

        if ('stencil' in options) {
          if (typeof options.stencil === 'boolean') {
            needsStencil = options.stencil
          } else {
            stencilBuffer = options.stencil
            needsDepth = false
          }
        }

        if ('depthStencil' in options) {
          if (typeof options.depthStencil === 'boolean') {
            needsDepth = needsStencil = options.depthStencil
          } else {
            depthStencilBuffer = options.depthStencil
            needsDepth = false
            needsStencil = false
          }
        }
      }

      // parse attachments
      var colorAttachments = null
      var depthAttachment = null
      var stencilAttachment = null
      var depthStencilAttachment = null

      // Set up color attachments
      if (Array.isArray(colorBuffer)) {
        colorAttachments = colorBuffer.map(parseAttachment)
      } else if (colorBuffer) {
        colorAttachments = [parseAttachment(colorBuffer)]
      } else {
        colorAttachments = new Array(colorCount)
        for (i = 0; i < colorCount; ++i) {
          colorAttachments[i] = allocAttachment(
            width,
            height,
            colorTexture,
            colorFormat,
            colorType)
        }
      }

      check$1(extensions.webgl_draw_buffers || colorAttachments.length <= 1,
        'you must enable the WEBGL_draw_buffers extension in order to use multiple color buffers.')
      check$1(colorAttachments.length <= limits.maxColorAttachments,
        'too many color attachments, not supported')

      width = width || colorAttachments[0].width
      height = height || colorAttachments[0].height

      if (depthBuffer) {
        depthAttachment = parseAttachment(depthBuffer)
      } else if (needsDepth && !needsStencil) {
        depthAttachment = allocAttachment(
          width,
          height,
          depthStencilTexture,
          'depth',
          'uint32')
      }

      if (stencilBuffer) {
        stencilAttachment = parseAttachment(stencilBuffer)
      } else if (needsStencil && !needsDepth) {
        stencilAttachment = allocAttachment(
          width,
          height,
          false,
          'stencil',
          'uint8')
      }

      if (depthStencilBuffer) {
        depthStencilAttachment = parseAttachment(depthStencilBuffer)
      } else if (!depthBuffer && !stencilBuffer && needsStencil && needsDepth) {
        depthStencilAttachment = allocAttachment(
          width,
          height,
          depthStencilTexture,
          'depth stencil',
          'depth stencil')
      }

      check$1(
        (!!depthBuffer) + (!!stencilBuffer) + (!!depthStencilBuffer) <= 1,
        'invalid framebuffer configuration, can specify exactly one depth/stencil attachment')

      var commonColorAttachmentSize = null

      for (i = 0; i < colorAttachments.length; ++i) {
        incRefAndCheckShape(colorAttachments[i], width, height)
        check$1(!colorAttachments[i] ||
          (colorAttachments[i].texture &&
            colorTextureFormatEnums.indexOf(colorAttachments[i].texture._texture.format) >= 0) ||
          (colorAttachments[i].renderbuffer &&
            colorRenderbufferFormatEnums.indexOf(colorAttachments[i].renderbuffer._renderbuffer.format) >= 0),
        'framebuffer color attachment ' + i + ' is invalid')

        if (colorAttachments[i] && colorAttachments[i].texture) {
          var colorAttachmentSize =
              textureFormatChannels[colorAttachments[i].texture._texture.format] *
              textureTypeSizes[colorAttachments[i].texture._texture.type]

          if (commonColorAttachmentSize === null) {
            commonColorAttachmentSize = colorAttachmentSize
          } else {
            // We need to make sure that all color attachments have the same number of bitplanes
            // (that is, the same numer of bits per pixel)
            // This is required by the GLES2.0 standard. See the beginning of Chapter 4 in that document.
            check$1(commonColorAttachmentSize === colorAttachmentSize,
              'all color attachments much have the same number of bits per pixel.')
          }
        }
      }
      incRefAndCheckShape(depthAttachment, width, height)
      check$1(!depthAttachment ||
        (depthAttachment.texture &&
          depthAttachment.texture._texture.format === GL_DEPTH_COMPONENT$1) ||
        (depthAttachment.renderbuffer &&
          depthAttachment.renderbuffer._renderbuffer.format === GL_DEPTH_COMPONENT16$1),
      'invalid depth attachment for framebuffer object')
      incRefAndCheckShape(stencilAttachment, width, height)
      check$1(!stencilAttachment ||
        (stencilAttachment.renderbuffer &&
          stencilAttachment.renderbuffer._renderbuffer.format === GL_STENCIL_INDEX8$1),
      'invalid stencil attachment for framebuffer object')
      incRefAndCheckShape(depthStencilAttachment, width, height)
      check$1(!depthStencilAttachment ||
        (depthStencilAttachment.texture &&
          depthStencilAttachment.texture._texture.format === GL_DEPTH_STENCIL$2) ||
        (depthStencilAttachment.renderbuffer &&
          depthStencilAttachment.renderbuffer._renderbuffer.format === GL_DEPTH_STENCIL$2),
      'invalid depth-stencil attachment for framebuffer object')

      // decrement references
      decFBORefs(framebuffer)

      framebuffer.width = width
      framebuffer.height = height

      framebuffer.colorAttachments = colorAttachments
      framebuffer.depthAttachment = depthAttachment
      framebuffer.stencilAttachment = stencilAttachment
      framebuffer.depthStencilAttachment = depthStencilAttachment

      reglFramebuffer.color = colorAttachments.map(unwrapAttachment)
      reglFramebuffer.depth = unwrapAttachment(depthAttachment)
      reglFramebuffer.stencil = unwrapAttachment(stencilAttachment)
      reglFramebuffer.depthStencil = unwrapAttachment(depthStencilAttachment)

      reglFramebuffer.width = framebuffer.width
      reglFramebuffer.height = framebuffer.height

      updateFramebuffer(framebuffer)

      return reglFramebuffer
    }

    function resize (w_, h_) {
      check$1(framebufferState.next !== framebuffer,
        'can not resize a framebuffer which is currently in use')

      var w = Math.max(w_ | 0, 1)
      var h = Math.max((h_ | 0) || w, 1)
      if (w === framebuffer.width && h === framebuffer.height) {
        return reglFramebuffer
      }

      // resize all buffers
      var colorAttachments = framebuffer.colorAttachments
      for (var i = 0; i < colorAttachments.length; ++i) {
        resizeAttachment(colorAttachments[i], w, h)
      }
      resizeAttachment(framebuffer.depthAttachment, w, h)
      resizeAttachment(framebuffer.stencilAttachment, w, h)
      resizeAttachment(framebuffer.depthStencilAttachment, w, h)

      framebuffer.width = reglFramebuffer.width = w
      framebuffer.height = reglFramebuffer.height = h

      updateFramebuffer(framebuffer)

      return reglFramebuffer
    }

    reglFramebuffer(a0, a1)

    return extend(reglFramebuffer, {
      resize: resize,
      _reglType: 'framebuffer',
      _framebuffer: framebuffer,
      destroy: function () {
        destroy(framebuffer)
        decFBORefs(framebuffer)
      },
      use: function (block) {
        framebufferState.setFBO({
          framebuffer: reglFramebuffer
        }, block)
      }
    })
  }

  function createCubeFBO (options) {
    var faces = Array(6)

    function reglFramebufferCube (a) {
      var i

      check$1(faces.indexOf(framebufferState.next) < 0,
        'can not update framebuffer which is currently in use')

      var params = {
        color: null
      }

      var radius = 0

      var colorBuffer = null
      var colorFormat = 'rgba'
      var colorType = 'uint8'
      var colorCount = 1

      if (typeof a === 'number') {
        radius = a | 0
      } else if (!a) {
        radius = 1
      } else {
        check$1.type(a, 'object', 'invalid arguments for framebuffer')
        var options = a

        if ('shape' in options) {
          var shape = options.shape
          check$1(
            Array.isArray(shape) && shape.length >= 2,
            'invalid shape for framebuffer')
          check$1(
            shape[0] === shape[1],
            'cube framebuffer must be square')
          radius = shape[0]
        } else {
          if ('radius' in options) {
            radius = options.radius | 0
          }
          if ('width' in options) {
            radius = options.width | 0
            if ('height' in options) {
              check$1(options.height === radius, 'must be square')
            }
          } else if ('height' in options) {
            radius = options.height | 0
          }
        }

        if ('color' in options ||
            'colors' in options) {
          colorBuffer =
            options.color ||
            options.colors
          if (Array.isArray(colorBuffer)) {
            check$1(
              colorBuffer.length === 1 || extensions.webgl_draw_buffers,
              'multiple render targets not supported')
          }
        }

        if (!colorBuffer) {
          if ('colorCount' in options) {
            colorCount = options.colorCount | 0
            check$1(colorCount > 0, 'invalid color buffer count')
          }

          if ('colorType' in options) {
            check$1.oneOf(
              options.colorType, colorTypes,
              'invalid color type')
            colorType = options.colorType
          }

          if ('colorFormat' in options) {
            colorFormat = options.colorFormat
            check$1.oneOf(
              options.colorFormat, colorTextureFormats,
              'invalid color format for texture')
          }
        }

        if ('depth' in options) {
          params.depth = options.depth
        }

        if ('stencil' in options) {
          params.stencil = options.stencil
        }

        if ('depthStencil' in options) {
          params.depthStencil = options.depthStencil
        }
      }

      var colorCubes
      if (colorBuffer) {
        if (Array.isArray(colorBuffer)) {
          colorCubes = []
          for (i = 0; i < colorBuffer.length; ++i) {
            colorCubes[i] = colorBuffer[i]
          }
        } else {
          colorCubes = [ colorBuffer ]
        }
      } else {
        colorCubes = Array(colorCount)
        var cubeMapParams = {
          radius: radius,
          format: colorFormat,
          type: colorType
        }
        for (i = 0; i < colorCount; ++i) {
          colorCubes[i] = textureState.createCube(cubeMapParams)
        }
      }

      // Check color cubes
      params.color = Array(colorCubes.length)
      for (i = 0; i < colorCubes.length; ++i) {
        var cube = colorCubes[i]
        check$1(
          typeof cube === 'function' && cube._reglType === 'textureCube',
          'invalid cube map')
        radius = radius || cube.width
        check$1(
          cube.width === radius && cube.height === radius,
          'invalid cube map shape')
        params.color[i] = {
          target: GL_TEXTURE_CUBE_MAP_POSITIVE_X$2,
          data: colorCubes[i]
        }
      }

      for (i = 0; i < 6; ++i) {
        for (var j = 0; j < colorCubes.length; ++j) {
          params.color[j].target = GL_TEXTURE_CUBE_MAP_POSITIVE_X$2 + i
        }
        // reuse depth-stencil attachments across all cube maps
        if (i > 0) {
          params.depth = faces[0].depth
          params.stencil = faces[0].stencil
          params.depthStencil = faces[0].depthStencil
        }
        if (faces[i]) {
          (faces[i])(params)
        } else {
          faces[i] = createFBO(params)
        }
      }

      return extend(reglFramebufferCube, {
        width: radius,
        height: radius,
        color: colorCubes
      })
    }

    function resize (radius_) {
      var i
      var radius = radius_ | 0
      check$1(radius > 0 && radius <= limits.maxCubeMapSize,
        'invalid radius for cube fbo')

      if (radius === reglFramebufferCube.width) {
        return reglFramebufferCube
      }

      var colors = reglFramebufferCube.color
      for (i = 0; i < colors.length; ++i) {
        colors[i].resize(radius)
      }

      for (i = 0; i < 6; ++i) {
        faces[i].resize(radius)
      }

      reglFramebufferCube.width = reglFramebufferCube.height = radius

      return reglFramebufferCube
    }

    reglFramebufferCube(options)

    return extend(reglFramebufferCube, {
      faces: faces,
      resize: resize,
      _reglType: 'framebufferCube',
      destroy: function () {
        faces.forEach(function (f) {
          f.destroy()
        })
      }
    })
  }

  function restoreFramebuffers () {
    framebufferState.cur = null
    framebufferState.next = null
    framebufferState.dirty = true
    values(framebufferSet).forEach(function (fb) {
      fb.framebuffer = gl.createFramebuffer()
      updateFramebuffer(fb)
    })
  }

  return extend(framebufferState, {
    getFramebuffer: function (object) {
      if (typeof object === 'function' && object._reglType === 'framebuffer') {
        var fbo = object._framebuffer
        if (fbo instanceof REGLFramebuffer) {
          return fbo
        }
      }
      return null
    },
    create: createFBO,
    createCube: createCubeFBO,
    clear: function () {
      values(framebufferSet).forEach(destroy)
    },
    restore: restoreFramebuffers
  })
}

var GL_FLOAT$6 = 5126
var GL_ARRAY_BUFFER$1 = 34962
var GL_ELEMENT_ARRAY_BUFFER$1 = 34963

var VAO_OPTIONS = [
  'attributes',
  'elements',
  'offset',
  'count',
  'primitive',
  'instances'
]

function AttributeRecord () {
  this.state = 0

  this.x = 0.0
  this.y = 0.0
  this.z = 0.0
  this.w = 0.0

  this.buffer = null
  this.size = 0
  this.normalized = false
  this.type = GL_FLOAT$6
  this.offset = 0
  this.stride = 0
  this.divisor = 0
}

function wrapAttributeState (
  gl,
  extensions,
  limits,
  stats,
  bufferState,
  elementState,
  drawState) {
  var NUM_ATTRIBUTES = limits.maxAttributes
  var attributeBindings = new Array(NUM_ATTRIBUTES)
  for (var i = 0; i < NUM_ATTRIBUTES; ++i) {
    attributeBindings[i] = new AttributeRecord()
  }
  var vaoCount = 0
  var vaoSet = {}

  var state = {
    Record: AttributeRecord,
    scope: {},
    state: attributeBindings,
    currentVAO: null,
    targetVAO: null,
    restore: extVAO() ? restoreVAO : function () {},
    createVAO: createVAO,
    getVAO: getVAO,
    destroyBuffer: destroyBuffer,
    setVAO: extVAO() ? setVAOEXT : setVAOEmulated,
    clear: extVAO() ? destroyVAOEXT : function () {}
  }

  function destroyBuffer (buffer) {
    for (var i = 0; i < attributeBindings.length; ++i) {
      var record = attributeBindings[i]
      if (record.buffer === buffer) {
        gl.disableVertexAttribArray(i)
        record.buffer = null
      }
    }
  }

  function extVAO () {
    return extensions.oes_vertex_array_object
  }

  function extInstanced () {
    return extensions.angle_instanced_arrays
  }

  function getVAO (vao) {
    if (typeof vao === 'function' && vao._vao) {
      return vao._vao
    }
    return null
  }

  function setVAOEXT (vao) {
    if (vao === state.currentVAO) {
      return
    }
    var ext = extVAO()
    if (vao) {
      ext.bindVertexArrayOES(vao.vao)
    } else {
      ext.bindVertexArrayOES(null)
    }
    state.currentVAO = vao
  }

  function setVAOEmulated (vao) {
    if (vao === state.currentVAO) {
      return
    }
    if (vao) {
      vao.bindAttrs()
    } else {
      var exti = extInstanced()
      for (var i = 0; i < attributeBindings.length; ++i) {
        var binding = attributeBindings[i]
        if (binding.buffer) {
          gl.enableVertexAttribArray(i)
          binding.buffer.bind()
          gl.vertexAttribPointer(i, binding.size, binding.type, binding.normalized, binding.stride, binding.offfset)
          if (exti && binding.divisor) {
            exti.vertexAttribDivisorANGLE(i, binding.divisor)
          }
        } else {
          gl.disableVertexAttribArray(i)
          gl.vertexAttrib4f(i, binding.x, binding.y, binding.z, binding.w)
        }
      }
      if (drawState.elements) {
        gl.bindBuffer(GL_ELEMENT_ARRAY_BUFFER$1, drawState.elements.buffer.buffer)
      } else {
        gl.bindBuffer(GL_ELEMENT_ARRAY_BUFFER$1, null)
      }
    }
    state.currentVAO = vao
  }

  function destroyVAOEXT () {
    values(vaoSet).forEach(function (vao) {
      vao.destroy()
    })
  }

  function REGLVAO () {
    this.id = ++vaoCount
    this.attributes = []
    this.elements = null
    this.ownsElements = false
    this.count = 0
    this.offset = 0
    this.instances = -1
    this.primitive = 4
    var extension = extVAO()
    if (extension) {
      this.vao = extension.createVertexArrayOES()
    } else {
      this.vao = null
    }
    vaoSet[this.id] = this
    this.buffers = []
  }

  REGLVAO.prototype.bindAttrs = function () {
    var exti = extInstanced()
    var attributes = this.attributes
    for (var i = 0; i < attributes.length; ++i) {
      var attr = attributes[i]
      if (attr.buffer) {
        gl.enableVertexAttribArray(i)
        gl.bindBuffer(GL_ARRAY_BUFFER$1, attr.buffer.buffer)
        gl.vertexAttribPointer(i, attr.size, attr.type, attr.normalized, attr.stride, attr.offset)
        if (exti && attr.divisor) {
          exti.vertexAttribDivisorANGLE(i, attr.divisor)
        }
      } else {
        gl.disableVertexAttribArray(i)
        gl.vertexAttrib4f(i, attr.x, attr.y, attr.z, attr.w)
      }
    }
    for (var j = attributes.length; j < NUM_ATTRIBUTES; ++j) {
      gl.disableVertexAttribArray(j)
    }
    var elements = elementState.getElements(this.elements)
    if (elements) {
      gl.bindBuffer(GL_ELEMENT_ARRAY_BUFFER$1, elements.buffer.buffer)
    } else {
      gl.bindBuffer(GL_ELEMENT_ARRAY_BUFFER$1, null)
    }
  }

  REGLVAO.prototype.refresh = function () {
    var ext = extVAO()
    if (ext) {
      ext.bindVertexArrayOES(this.vao)
      this.bindAttrs()
      state.currentVAO = null
      ext.bindVertexArrayOES(null)
    }
  }

  REGLVAO.prototype.destroy = function () {
    if (this.vao) {
      var extension = extVAO()
      if (this === state.currentVAO) {
        state.currentVAO = null
        extension.bindVertexArrayOES(null)
      }
      extension.deleteVertexArrayOES(this.vao)
      this.vao = null
    }
    if (this.ownsElements) {
      this.elements.destroy()
      this.elements = null
      this.ownsElements = false
    }
    if (vaoSet[this.id]) {
      delete vaoSet[this.id]
      stats.vaoCount -= 1
    }
  }

  function restoreVAO () {
    var ext = extVAO()
    if (ext) {
      values(vaoSet).forEach(function (vao) {
        vao.refresh()
      })
    }
  }

  function createVAO (_attr) {
    var vao = new REGLVAO()
    stats.vaoCount += 1

    function updateVAO (options) {
      var attributes
      if (Array.isArray(options)) {
        attributes = options
        if (vao.elements && vao.ownsElements) {
          vao.elements.destroy()
        }
        vao.elements = null
        vao.ownsElements = false
        vao.offset = 0
        vao.count = 0
        vao.instances = -1
        vao.primitive = 4
      } else {
        check$1(typeof options === 'object', 'invalid arguments for create vao')
        check$1('attributes' in options, 'must specify attributes for vao')
        if (options.elements) {
          var elements = options.elements
          if (vao.ownsElements) {
            if (typeof elements === 'function' && elements._reglType === 'elements') {
              vao.elements.destroy()
              vao.ownsElements = false
            } else {
              vao.elements(elements)
              vao.ownsElements = false
            }
          } else if (elementState.getElements(options.elements)) {
            vao.elements = options.elements
            vao.ownsElements = false
          } else {
            vao.elements = elementState.create(options.elements)
            vao.ownsElements = true
          }
        } else {
          vao.elements = null
          vao.ownsElements = false
        }
        attributes = options.attributes

        // set default vao
        vao.offset = 0
        vao.count = -1
        vao.instances = -1
        vao.primitive = 4

        // copy element properties
        if (vao.elements) {
          vao.count = vao.elements._elements.vertCount
          vao.primitive = vao.elements._elements.primType
        }

        if ('offset' in options) {
          vao.offset = options.offset | 0
        }
        if ('count' in options) {
          vao.count = options.count | 0
        }
        if ('instances' in options) {
          vao.instances = options.instances | 0
        }
        if ('primitive' in options) {
          check$1(options.primitive in primTypes, 'bad primitive type: ' + options.primitive)
          vao.primitive = primTypes[options.primitive]
        }

        check$1.optional(function () {
          var keys = sortedObjectKeys(options)
          for (var i = 0; i < keys.length; ++i) {
            check$1(VAO_OPTIONS.indexOf(keys[i]) >= 0, 'invalid option for vao: "' + keys[i] + '" valid options are ' + VAO_OPTIONS)
          }
        })
        check$1(Array.isArray(attributes), 'attributes must be an array')
      }

      check$1(attributes.length < NUM_ATTRIBUTES, 'too many attributes')
      check$1(attributes.length > 0, 'must specify at least one attribute')

      var bufUpdated = {}
      var nattributes = vao.attributes
      nattributes.length = attributes.length
      for (var i = 0; i < attributes.length; ++i) {
        var spec = attributes[i]
        var rec = nattributes[i] = new AttributeRecord()
        var data = spec.data || spec
        if (Array.isArray(data) || isTypedArray(data) || isNDArrayLike(data)) {
          var buf
          if (vao.buffers[i]) {
            buf = vao.buffers[i]
            if (isTypedArray(data) && buf._buffer.byteLength >= data.byteLength) {
              buf.subdata(data)
            } else {
              buf.destroy()
              vao.buffers[i] = null
            }
          }
          if (!vao.buffers[i]) {
            buf = vao.buffers[i] = bufferState.create(spec, GL_ARRAY_BUFFER$1, false, true)
          }
          rec.buffer = bufferState.getBuffer(buf)
          rec.size = rec.buffer.dimension | 0
          rec.normalized = false
          rec.type = rec.buffer.dtype
          rec.offset = 0
          rec.stride = 0
          rec.divisor = 0
          rec.state = 1
          bufUpdated[i] = 1
        } else if (bufferState.getBuffer(spec)) {
          rec.buffer = bufferState.getBuffer(spec)
          rec.size = rec.buffer.dimension | 0
          rec.normalized = false
          rec.type = rec.buffer.dtype
          rec.offset = 0
          rec.stride = 0
          rec.divisor = 0
          rec.state = 1
        } else if (bufferState.getBuffer(spec.buffer)) {
          rec.buffer = bufferState.getBuffer(spec.buffer)
          rec.size = ((+spec.size) || rec.buffer.dimension) | 0
          rec.normalized = !!spec.normalized || false
          if ('type' in spec) {
            check$1.parameter(spec.type, glTypes, 'invalid buffer type')
            rec.type = glTypes[spec.type]
          } else {
            rec.type = rec.buffer.dtype
          }
          rec.offset = (spec.offset || 0) | 0
          rec.stride = (spec.stride || 0) | 0
          rec.divisor = (spec.divisor || 0) | 0
          rec.state = 1

          check$1(rec.size >= 1 && rec.size <= 4, 'size must be between 1 and 4')
          check$1(rec.offset >= 0, 'invalid offset')
          check$1(rec.stride >= 0 && rec.stride <= 255, 'stride must be between 0 and 255')
          check$1(rec.divisor >= 0, 'divisor must be positive')
          check$1(!rec.divisor || !!extensions.angle_instanced_arrays, 'ANGLE_instanced_arrays must be enabled to use divisor')
        } else if ('x' in spec) {
          check$1(i > 0, 'first attribute must not be a constant')
          rec.x = +spec.x || 0
          rec.y = +spec.y || 0
          rec.z = +spec.z || 0
          rec.w = +spec.w || 0
          rec.state = 2
        } else {
          check$1(false, 'invalid attribute spec for location ' + i)
        }
      }

      // retire unused buffers
      for (var j = 0; j < vao.buffers.length; ++j) {
        if (!bufUpdated[j] && vao.buffers[j]) {
          vao.buffers[j].destroy()
          vao.buffers[j] = null
        }
      }

      vao.refresh()
      return updateVAO
    }

    updateVAO.destroy = function () {
      for (var j = 0; j < vao.buffers.length; ++j) {
        if (vao.buffers[j]) {
          vao.buffers[j].destroy()
        }
      }
      vao.buffers.length = 0

      if (vao.ownsElements) {
        vao.elements.destroy()
        vao.elements = null
        vao.ownsElements = false
      }

      vao.destroy()
    }

    updateVAO._vao = vao
    updateVAO._reglType = 'vao'

    return updateVAO(_attr)
  }

  return state
}

var GL_FRAGMENT_SHADER = 35632
var GL_VERTEX_SHADER = 35633

var GL_ACTIVE_UNIFORMS = 0x8B86
var GL_ACTIVE_ATTRIBUTES = 0x8B89

function wrapShaderState (gl, stringStore, stats, config) {
  // ===================================================
  // glsl compilation and linking
  // ===================================================
  var fragShaders = {}
  var vertShaders = {}

  function ActiveInfo (name, id, location, info) {
    this.name = name
    this.id = id
    this.location = location
    this.info = info
  }

  function insertActiveInfo (list, info) {
    for (var i = 0; i < list.length; ++i) {
      if (list[i].id === info.id) {
        list[i].location = info.location
        return
      }
    }
    list.push(info)
  }

  function getShader (type, id, command) {
    var cache = type === GL_FRAGMENT_SHADER ? fragShaders : vertShaders
    var shader = cache[id]

    if (!shader) {
      var source = stringStore.str(id)
      shader = gl.createShader(type)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      check$1.shaderError(gl, shader, source, type, command)
      cache[id] = shader
    }

    return shader
  }

  // ===================================================
  // program linking
  // ===================================================
  var programCache = {}
  var programList = []

  var PROGRAM_COUNTER = 0

  function REGLProgram (fragId, vertId) {
    this.id = PROGRAM_COUNTER++
    this.fragId = fragId
    this.vertId = vertId
    this.program = null
    this.uniforms = []
    this.attributes = []
    this.refCount = 1

    if (config.profile) {
      this.stats = {
        uniformsCount: 0,
        attributesCount: 0
      }
    }
  }

  function linkProgram (desc, command, attributeLocations) {
    var i, info

    // -------------------------------
    // compile & link
    // -------------------------------
    var fragShader = getShader(GL_FRAGMENT_SHADER, desc.fragId)
    var vertShader = getShader(GL_VERTEX_SHADER, desc.vertId)

    var program = desc.program = gl.createProgram()
    gl.attachShader(program, fragShader)
    gl.attachShader(program, vertShader)
    if (attributeLocations) {
      for (i = 0; i < attributeLocations.length; ++i) {
        var binding = attributeLocations[i]
        gl.bindAttribLocation(program, binding[0], binding[1])
      }
    }

    gl.linkProgram(program)
    check$1.linkError(
      gl,
      program,
      stringStore.str(desc.fragId),
      stringStore.str(desc.vertId),
      command)

    // -------------------------------
    // grab uniforms
    // -------------------------------
    var numUniforms = gl.getProgramParameter(program, GL_ACTIVE_UNIFORMS)
    if (config.profile) {
      desc.stats.uniformsCount = numUniforms
    }
    var uniforms = desc.uniforms
    for (i = 0; i < numUniforms; ++i) {
      info = gl.getActiveUniform(program, i)
      if (info) {
        if (info.size > 1) {
          for (var j = 0; j < info.size; ++j) {
            var name = info.name.replace('[0]', '[' + j + ']')
            insertActiveInfo(uniforms, new ActiveInfo(
              name,
              stringStore.id(name),
              gl.getUniformLocation(program, name),
              info))
          }
        } else {
          insertActiveInfo(uniforms, new ActiveInfo(
            info.name,
            stringStore.id(info.name),
            gl.getUniformLocation(program, info.name),
            info))
        }
      }
    }

    // -------------------------------
    // grab attributes
    // -------------------------------
    var numAttributes = gl.getProgramParameter(program, GL_ACTIVE_ATTRIBUTES)
    if (config.profile) {
      desc.stats.attributesCount = numAttributes
    }

    var attributes = desc.attributes
    for (i = 0; i < numAttributes; ++i) {
      info = gl.getActiveAttrib(program, i)
      if (info) {
        insertActiveInfo(attributes, new ActiveInfo(
          info.name,
          stringStore.id(info.name),
          gl.getAttribLocation(program, info.name),
          info))
      }
    }
  }

  if (config.profile) {
    stats.getMaxUniformsCount = function () {
      var m = 0
      programList.forEach(function (desc) {
        if (desc.stats.uniformsCount > m) {
          m = desc.stats.uniformsCount
        }
      })
      return m
    }

    stats.getMaxAttributesCount = function () {
      var m = 0
      programList.forEach(function (desc) {
        if (desc.stats.attributesCount > m) {
          m = desc.stats.attributesCount
        }
      })
      return m
    }
  }

  function restoreShaders () {
    fragShaders = {}
    vertShaders = {}
    for (var i = 0; i < programList.length; ++i) {
      linkProgram(programList[i], null, programList[i].attributes.map(function (info) {
        return [info.location, info.name]
      }))
    }
  }

  return {
    clear: function () {
      var deleteShader = gl.deleteShader.bind(gl)
      values(fragShaders).forEach(deleteShader)
      fragShaders = {}
      values(vertShaders).forEach(deleteShader)
      vertShaders = {}

      programList.forEach(function (desc) {
        gl.deleteProgram(desc.program)
      })
      programList.length = 0
      programCache = {}

      stats.shaderCount = 0
    },

    program: function (vertId, fragId, command, attribLocations) {
      check$1.command(vertId >= 0, 'missing vertex shader', command)
      check$1.command(fragId >= 0, 'missing fragment shader', command)

      var cache = programCache[fragId]
      if (!cache) {
        cache = programCache[fragId] = {}
      }
      var prevProgram = cache[vertId]
      if (prevProgram) {
        prevProgram.refCount++
        if (!attribLocations) {
          return prevProgram
        }
      }
      var program = new REGLProgram(fragId, vertId)
      stats.shaderCount++
      linkProgram(program, command, attribLocations)
      if (!prevProgram) {
        cache[vertId] = program
      }
      programList.push(program)
      return extend(program, {
        destroy: function () {
          program.refCount--
          if (program.refCount <= 0) {
            gl.deleteProgram(program.program)
            var idx = programList.indexOf(program)
            programList.splice(idx, 1)
            stats.shaderCount--
          }
          // no program is linked to this vert anymore
          if (cache[program.vertId].refCount <= 0) {
            gl.deleteShader(vertShaders[program.vertId])
            delete vertShaders[program.vertId]
            delete programCache[program.fragId][program.vertId]
          }
          // no program is linked to this frag anymore
          if (!sortedObjectKeys(programCache[program.fragId]).length) {
            gl.deleteShader(fragShaders[program.fragId])
            delete fragShaders[program.fragId]
            delete programCache[program.fragId]
          }
        }
      })
    },

    restore: restoreShaders,

    shader: getShader,

    frag: -1,
    vert: -1
  }
}

var GL_RGBA$3 = 6408
var GL_UNSIGNED_BYTE$7 = 5121
var GL_PACK_ALIGNMENT = 0x0D05
var GL_FLOAT$7 = 0x1406 // 5126

function wrapReadPixels (
  gl,
  framebufferState,
  reglPoll,
  context,
  glAttributes,
  extensions,
  limits) {
  function readPixelsImpl (input) {
    var type
    if (framebufferState.next === null) {
      check$1(
        glAttributes.preserveDrawingBuffer,
        'you must create a webgl context with "preserveDrawingBuffer":true in order to read pixels from the drawing buffer')
      type = GL_UNSIGNED_BYTE$7
    } else {
      check$1(
        framebufferState.next.colorAttachments[0].texture !== null,
        'You cannot read from a renderbuffer')
      type = framebufferState.next.colorAttachments[0].texture._texture.type

      check$1.optional(function () {
        if (extensions.oes_texture_float) {
          check$1(
            type === GL_UNSIGNED_BYTE$7 || type === GL_FLOAT$7,
            'Reading from a framebuffer is only allowed for the types \'uint8\' and \'float\'')

          if (type === GL_FLOAT$7) {
            check$1(limits.readFloat, 'Reading \'float\' values is not permitted in your browser. For a fallback, please see: https://www.npmjs.com/package/glsl-read-float')
          }
        } else {
          check$1(
            type === GL_UNSIGNED_BYTE$7,
            'Reading from a framebuffer is only allowed for the type \'uint8\'')
        }
      })
    }

    var x = 0
    var y = 0
    var width = context.framebufferWidth
    var height = context.framebufferHeight
    var data = null

    if (isTypedArray(input)) {
      data = input
    } else if (input) {
      check$1.type(input, 'object', 'invalid arguments to regl.read()')
      x = input.x | 0
      y = input.y | 0
      check$1(
        x >= 0 && x < context.framebufferWidth,
        'invalid x offset for regl.read')
      check$1(
        y >= 0 && y < context.framebufferHeight,
        'invalid y offset for regl.read')
      width = (input.width || (context.framebufferWidth - x)) | 0
      height = (input.height || (context.framebufferHeight - y)) | 0
      data = input.data || null
    }

    // sanity check input.data
    if (data) {
      if (type === GL_UNSIGNED_BYTE$7) {
        check$1(
          data instanceof Uint8Array,
          'buffer must be \'Uint8Array\' when reading from a framebuffer of type \'uint8\'')
      } else if (type === GL_FLOAT$7) {
        check$1(
          data instanceof Float32Array,
          'buffer must be \'Float32Array\' when reading from a framebuffer of type \'float\'')
      }
    }

    check$1(
      width > 0 && width + x <= context.framebufferWidth,
      'invalid width for read pixels')
    check$1(
      height > 0 && height + y <= context.framebufferHeight,
      'invalid height for read pixels')

    // Update WebGL state
    reglPoll()

    // Compute size
    var size = width * height * 4

    // Allocate data
    if (!data) {
      if (type === GL_UNSIGNED_BYTE$7) {
        data = new Uint8Array(size)
      } else if (type === GL_FLOAT$7) {
        data = data || new Float32Array(size)
      }
    }

    // Type check
    check$1.isTypedArray(data, 'data buffer for regl.read() must be a typedarray')
    check$1(data.byteLength >= size, 'data buffer for regl.read() too small')

    // Run read pixels
    gl.pixelStorei(GL_PACK_ALIGNMENT, 4)
    gl.readPixels(x, y, width, height, GL_RGBA$3,
      type,
      data)

    return data
  }

  function readPixelsFBO (options) {
    var result
    framebufferState.setFBO({
      framebuffer: options.framebuffer
    }, function () {
      result = readPixelsImpl(options)
    })
    return result
  }

  function readPixels (options) {
    if (!options || !('framebuffer' in options)) {
      return readPixelsImpl(options)
    } else {
      return readPixelsFBO(options)
    }
  }

  return readPixels
}

var allFns = {
 '$0': function ($0
 ) {
  'use strict';
  var v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15, v16, v17, v18, v19, v20, v21, v22, v23, v24, v25, v26, v27, v28, v29, v30, v31, v32, v33, v34, v35, v36, v37, v38, v39, v40, v41, v42, v43, v44, v45, v46, v74, v75, v76, v77, v78, v79, v80, v81, v88, v89, v94, v95, v96, v97, v98, v99, v100, v101, v104, v105, v106, v107, v108, v109;
  v0 = $0.attributes;
  v1 = $0.buffer;
  v2 = $0.context;
  v3 = $0.current;
  v4 = $0.draw;
  v5 = $0.elements;
  v6 = $0.extensions;
  v7 = $0.framebuffer;
  v8 = $0.gl;
  v9 = $0.isBufferArgs;
  v10 = $0.next;
  v11 = $0.shader;
  v12 = $0.strings;
  v13 = $0.timer;
  v14 = $0.uniforms;
  v15 = $0.vao;
  v16 = v10.blend_color;
  v17 = v3.blend_color;
  v18 = v10.blend_equation;
  v19 = v3.blend_equation;
  v20 = v10.blend_func;
  v21 = v3.blend_func;
  v22 = v10.colorMask;
  v23 = v3.colorMask;
  v24 = v10.depth_range;
  v25 = v3.depth_range;
  v26 = v10.polygonOffset_offset;
  v27 = v3.polygonOffset_offset;
  v28 = v10.sample_coverage;
  v29 = v3.sample_coverage;
  v30 = v10.scissor_box;
  v31 = v3.scissor_box;
  v32 = v10.stencil_func;
  v33 = v3.stencil_func;
  v34 = v10.stencil_opBack;
  v35 = v3.stencil_opBack;
  v36 = v10.stencil_opFront;
  v37 = v3.stencil_opFront;
  v38 = v10.viewport;
  v39 = v3.viewport;
  v40 = {
   'add': 32774, 'subtract': 32778, 'reverse subtract': 32779
  }
   ;
  v41 = {
   '0': 0, '1': 1, 'zero': 0, 'one': 1, 'src color': 768, 'one minus src color': 769, 'src alpha': 770, 'one minus src alpha': 771, 'dst color': 774, 'one minus dst color': 775, 'dst alpha': 772, 'one minus dst alpha': 773, 'constant color': 32769, 'one minus constant color': 32770, 'constant alpha': 32771, 'one minus constant alpha': 32772, 'src alpha saturate': 776
  }
   ;
  v42 = {
   'never': 512, 'less': 513, '<': 513, 'equal': 514, '=': 514, '==': 514, '===': 514, 'lequal': 515, '<=': 515, 'greater': 516, '>': 516, 'notequal': 517, '!=': 517, '!==': 517, 'gequal': 518, '>=': 518, 'always': 519
  }
   ;
  v43 = {
   'int8': 5120, 'int16': 5122, 'int32': 5124, 'uint8': 5121, 'uint16': 5123, 'uint32': 5125, 'float': 5126, 'float32': 5126
  }
   ;
  v44 = {
   'cw': 2304, 'ccw': 2305
  }
   ;
  v45 = {
   'points': 0, 'point': 0, 'lines': 1, 'line': 1, 'triangles': 4, 'triangle': 4, 'line loop': 2, 'line strip': 3, 'triangle strip': 5, 'triangle fan': 6
  }
   ;
  v46 = {
   '0': 0, 'zero': 0, 'keep': 7680, 'replace': 7681, 'increment': 7682, 'decrement': 7683, 'increment wrap': 34055, 'decrement wrap': 34056, 'invert': 5386
  }
   ;
  v74 = v10.blend_color;
  v75 = v3.blend_color;
  v76 = v10.blend_equation;
  v77 = v3.blend_equation;
  v78 = v10.blend_func;
  v79 = v3.blend_func;
  v80 = v10.colorMask;
  v81 = v3.colorMask;
  v88 = v10.depth_range;
  v89 = v3.depth_range;
  v94 = v10.polygonOffset_offset;
  v95 = v3.polygonOffset_offset;
  v96 = v10.sample_coverage;
  v97 = v3.sample_coverage;
  v98 = v10.scissor_box;
  v99 = v3.scissor_box;
  v100 = v10.stencil_func;
  v101 = v3.stencil_func;
  v104 = v10.stencil_opBack;
  v105 = v3.stencil_opBack;
  v106 = v10.stencil_opFront;
  v107 = v3.stencil_opFront;
  v108 = v10.viewport;
  v109 = v3.viewport;
  return {
   'poll': function () {
    var v47;
    var v65, v66, v67, v68, v69, v70, v71, v72, v73, v82, v83, v84, v85, v86, v87, v90, v91, v92, v93, v102, v103;
    v3.dirty = false;
    v65 = v10.blend_enable;
    v66 = v10.cull_enable;
    v67 = v10.depth_enable;
    v68 = v10.dither;
    v69 = v10.polygonOffset_enable;
    v70 = v10.sample_alpha;
    v71 = v10.sample_enable;
    v72 = v10.scissor_enable;
    v73 = v10.stencil_enable;
    v82 = v10.cull_face;
    v83 = v3.cull_face;
    v84 = v10.depth_func;
    v85 = v3.depth_func;
    v86 = v10.depth_mask;
    v87 = v3.depth_mask;
    v90 = v10.frontFace;
    v91 = v3.frontFace;
    v92 = v10.lineWidth;
    v93 = v3.lineWidth;
    v102 = v10.stencil_mask;
    v103 = v3.stencil_mask;
    v47 = v7.next;
    if (v47 !== v7.cur) {
     if (v47) {
      v8.bindFramebuffer(36160, v47.framebuffer);
     }
     else {
      v8.bindFramebuffer(36160, null);
     }
     v7.cur = v47;
    }
    if (v65 !== v3.blend_enable) {
     if (v65) {
      v8.enable(3042)
     }
     else {
      v8.disable(3042)
     }
     v3.blend_enable = v65;
    }
    if (v66 !== v3.cull_enable) {
     if (v66) {
      v8.enable(2884)
     }
     else {
      v8.disable(2884)
     }
     v3.cull_enable = v66;
    }
    if (v67 !== v3.depth_enable) {
     if (v67) {
      v8.enable(2929)
     }
     else {
      v8.disable(2929)
     }
     v3.depth_enable = v67;
    }
    if (v68 !== v3.dither) {
     if (v68) {
      v8.enable(3024)
     }
     else {
      v8.disable(3024)
     }
     v3.dither = v68;
    }
    if (v69 !== v3.polygonOffset_enable) {
     if (v69) {
      v8.enable(32823)
     }
     else {
      v8.disable(32823)
     }
     v3.polygonOffset_enable = v69;
    }
    if (v70 !== v3.sample_alpha) {
     if (v70) {
      v8.enable(32926)
     }
     else {
      v8.disable(32926)
     }
     v3.sample_alpha = v70;
    }
    if (v71 !== v3.sample_enable) {
     if (v71) {
      v8.enable(32928)
     }
     else {
      v8.disable(32928)
     }
     v3.sample_enable = v71;
    }
    if (v72 !== v3.scissor_enable) {
     if (v72) {
      v8.enable(3089)
     }
     else {
      v8.disable(3089)
     }
     v3.scissor_enable = v72;
    }
    if (v73 !== v3.stencil_enable) {
     if (v73) {
      v8.enable(2960)
     }
     else {
      v8.disable(2960)
     }
     v3.stencil_enable = v73;
    }
    if (v74[0] !== v75[0] || v74[1] !== v75[1] || v74[2] !== v75[2] || v74[3] !== v75[3]) {
     v8.blendColor(v74[0], v74[1], v74[2], v74[3]);
     v75[0] = v74[0];
     v75[1] = v74[1];
     v75[2] = v74[2];
     v75[3] = v74[3];
    }
    if (v76[0] !== v77[0] || v76[1] !== v77[1]) {
     v8.blendEquationSeparate(v76[0], v76[1]);
     v77[0] = v76[0];
     v77[1] = v76[1];
    }
    if (v78[0] !== v79[0] || v78[1] !== v79[1] || v78[2] !== v79[2] || v78[3] !== v79[3]) {
     v8.blendFuncSeparate(v78[0], v78[1], v78[2], v78[3]);
     v79[0] = v78[0];
     v79[1] = v78[1];
     v79[2] = v78[2];
     v79[3] = v78[3];
    }
    if (v80[0] !== v81[0] || v80[1] !== v81[1] || v80[2] !== v81[2] || v80[3] !== v81[3]) {
     v8.colorMask(v80[0], v80[1], v80[2], v80[3]);
     v81[0] = v80[0];
     v81[1] = v80[1];
     v81[2] = v80[2];
     v81[3] = v80[3];
    }
    if (v82 !== v83) {
     v8.cullFace(v82);
     v3.cull_face = v82;
    }
    if (v84 !== v85) {
     v8.depthFunc(v84);
     v3.depth_func = v84;
    }
    if (v86 !== v87) {
     v8.depthMask(v86);
     v3.depth_mask = v86;
    }
    if (v88[0] !== v89[0] || v88[1] !== v89[1]) {
     v8.depthRange(v88[0], v88[1]);
     v89[0] = v88[0];
     v89[1] = v88[1];
    }
    if (v90 !== v91) {
     v8.frontFace(v90);
     v3.frontFace = v90;
    }
    if (v92 !== v93) {
     v8.lineWidth(v92);
     v3.lineWidth = v92;
    }
    if (v94[0] !== v95[0] || v94[1] !== v95[1]) {
     v8.polygonOffset(v94[0], v94[1]);
     v95[0] = v94[0];
     v95[1] = v94[1];
    }
    if (v96[0] !== v97[0] || v96[1] !== v97[1]) {
     v8.sampleCoverage(v96[0], v96[1]);
     v97[0] = v96[0];
     v97[1] = v96[1];
    }
    if (v98[0] !== v99[0] || v98[1] !== v99[1] || v98[2] !== v99[2] || v98[3] !== v99[3]) {
     v8.scissor(v98[0], v98[1], v98[2], v98[3]);
     v99[0] = v98[0];
     v99[1] = v98[1];
     v99[2] = v98[2];
     v99[3] = v98[3];
    }
    if (v100[0] !== v101[0] || v100[1] !== v101[1] || v100[2] !== v101[2]) {
     v8.stencilFunc(v100[0], v100[1], v100[2]);
     v101[0] = v100[0];
     v101[1] = v100[1];
     v101[2] = v100[2];
    }
    if (v102 !== v103) {
     v8.stencilMask(v102);
     v3.stencil_mask = v102;
    }
    if (v104[0] !== v105[0] || v104[1] !== v105[1] || v104[2] !== v105[2] || v104[3] !== v105[3]) {
     v8.stencilOpSeparate(v104[0], v104[1], v104[2], v104[3]);
     v105[0] = v104[0];
     v105[1] = v104[1];
     v105[2] = v104[2];
     v105[3] = v104[3];
    }
    if (v106[0] !== v107[0] || v106[1] !== v107[1] || v106[2] !== v107[2] || v106[3] !== v107[3]) {
     v8.stencilOpSeparate(v106[0], v106[1], v106[2], v106[3]);
     v107[0] = v106[0];
     v107[1] = v106[1];
     v107[2] = v106[2];
     v107[3] = v106[3];
    }
    if (v108[0] !== v109[0] || v108[1] !== v109[1] || v108[2] !== v109[2] || v108[3] !== v109[3]) {
     v8.viewport(v108[0], v108[1], v108[2], v108[3]);
     v109[0] = v108[0];
     v109[1] = v108[1];
     v109[2] = v108[2];
     v109[3] = v108[3];
    }
   }
   , 'refresh': function () {
    var v48, v49, v50, v51, v52, v53, v54, v55, v56, v57, v58, v59, v60, v61, v62, v63, v64;
    var v65, v66, v67, v68, v69, v70, v71, v72, v73, v82, v83, v84, v85, v86, v87, v90, v91, v92, v93, v102, v103;
    v3.dirty = false;
    v65 = v10.blend_enable;
    v66 = v10.cull_enable;
    v67 = v10.depth_enable;
    v68 = v10.dither;
    v69 = v10.polygonOffset_enable;
    v70 = v10.sample_alpha;
    v71 = v10.sample_enable;
    v72 = v10.scissor_enable;
    v73 = v10.stencil_enable;
    v82 = v10.cull_face;
    v83 = v3.cull_face;
    v84 = v10.depth_func;
    v85 = v3.depth_func;
    v86 = v10.depth_mask;
    v87 = v3.depth_mask;
    v90 = v10.frontFace;
    v91 = v3.frontFace;
    v92 = v10.lineWidth;
    v93 = v3.lineWidth;
    v102 = v10.stencil_mask;
    v103 = v3.stencil_mask;
    v48 = v7.next;
    if (v48) {
     v8.bindFramebuffer(36160, v48.framebuffer);
    }
    else {
     v8.bindFramebuffer(36160, null);
    }
    v7.cur = v48;
    v49 = v0[0];
    if (v49.buffer) {
     v8.enableVertexAttribArray(0);
     v8.bindBuffer(34962, v49.buffer.buffer);
     v8.vertexAttribPointer(0, v49.size, v49.type, v49.normalized, v49.stride, v49.offset);
    }
    else {
     v8.disableVertexAttribArray(0);
     v8.vertexAttrib4f(0, v49.x, v49.y, v49.z, v49.w);
     v49.buffer = null;
    }
    v50 = v0[1];
    if (v50.buffer) {
     v8.enableVertexAttribArray(1);
     v8.bindBuffer(34962, v50.buffer.buffer);
     v8.vertexAttribPointer(1, v50.size, v50.type, v50.normalized, v50.stride, v50.offset);
    }
    else {
     v8.disableVertexAttribArray(1);
     v8.vertexAttrib4f(1, v50.x, v50.y, v50.z, v50.w);
     v50.buffer = null;
    }
    v51 = v0[2];
    if (v51.buffer) {
     v8.enableVertexAttribArray(2);
     v8.bindBuffer(34962, v51.buffer.buffer);
     v8.vertexAttribPointer(2, v51.size, v51.type, v51.normalized, v51.stride, v51.offset);
    }
    else {
     v8.disableVertexAttribArray(2);
     v8.vertexAttrib4f(2, v51.x, v51.y, v51.z, v51.w);
     v51.buffer = null;
    }
    v52 = v0[3];
    if (v52.buffer) {
     v8.enableVertexAttribArray(3);
     v8.bindBuffer(34962, v52.buffer.buffer);
     v8.vertexAttribPointer(3, v52.size, v52.type, v52.normalized, v52.stride, v52.offset);
    }
    else {
     v8.disableVertexAttribArray(3);
     v8.vertexAttrib4f(3, v52.x, v52.y, v52.z, v52.w);
     v52.buffer = null;
    }
    v53 = v0[4];
    if (v53.buffer) {
     v8.enableVertexAttribArray(4);
     v8.bindBuffer(34962, v53.buffer.buffer);
     v8.vertexAttribPointer(4, v53.size, v53.type, v53.normalized, v53.stride, v53.offset);
    }
    else {
     v8.disableVertexAttribArray(4);
     v8.vertexAttrib4f(4, v53.x, v53.y, v53.z, v53.w);
     v53.buffer = null;
    }
    v54 = v0[5];
    if (v54.buffer) {
     v8.enableVertexAttribArray(5);
     v8.bindBuffer(34962, v54.buffer.buffer);
     v8.vertexAttribPointer(5, v54.size, v54.type, v54.normalized, v54.stride, v54.offset);
    }
    else {
     v8.disableVertexAttribArray(5);
     v8.vertexAttrib4f(5, v54.x, v54.y, v54.z, v54.w);
     v54.buffer = null;
    }
    v55 = v0[6];
    if (v55.buffer) {
     v8.enableVertexAttribArray(6);
     v8.bindBuffer(34962, v55.buffer.buffer);
     v8.vertexAttribPointer(6, v55.size, v55.type, v55.normalized, v55.stride, v55.offset);
    }
    else {
     v8.disableVertexAttribArray(6);
     v8.vertexAttrib4f(6, v55.x, v55.y, v55.z, v55.w);
     v55.buffer = null;
    }
    v56 = v0[7];
    if (v56.buffer) {
     v8.enableVertexAttribArray(7);
     v8.bindBuffer(34962, v56.buffer.buffer);
     v8.vertexAttribPointer(7, v56.size, v56.type, v56.normalized, v56.stride, v56.offset);
    }
    else {
     v8.disableVertexAttribArray(7);
     v8.vertexAttrib4f(7, v56.x, v56.y, v56.z, v56.w);
     v56.buffer = null;
    }
    v57 = v0[8];
    if (v57.buffer) {
     v8.enableVertexAttribArray(8);
     v8.bindBuffer(34962, v57.buffer.buffer);
     v8.vertexAttribPointer(8, v57.size, v57.type, v57.normalized, v57.stride, v57.offset);
    }
    else {
     v8.disableVertexAttribArray(8);
     v8.vertexAttrib4f(8, v57.x, v57.y, v57.z, v57.w);
     v57.buffer = null;
    }
    v58 = v0[9];
    if (v58.buffer) {
     v8.enableVertexAttribArray(9);
     v8.bindBuffer(34962, v58.buffer.buffer);
     v8.vertexAttribPointer(9, v58.size, v58.type, v58.normalized, v58.stride, v58.offset);
    }
    else {
     v8.disableVertexAttribArray(9);
     v8.vertexAttrib4f(9, v58.x, v58.y, v58.z, v58.w);
     v58.buffer = null;
    }
    v59 = v0[10];
    if (v59.buffer) {
     v8.enableVertexAttribArray(10);
     v8.bindBuffer(34962, v59.buffer.buffer);
     v8.vertexAttribPointer(10, v59.size, v59.type, v59.normalized, v59.stride, v59.offset);
    }
    else {
     v8.disableVertexAttribArray(10);
     v8.vertexAttrib4f(10, v59.x, v59.y, v59.z, v59.w);
     v59.buffer = null;
    }
    v60 = v0[11];
    if (v60.buffer) {
     v8.enableVertexAttribArray(11);
     v8.bindBuffer(34962, v60.buffer.buffer);
     v8.vertexAttribPointer(11, v60.size, v60.type, v60.normalized, v60.stride, v60.offset);
    }
    else {
     v8.disableVertexAttribArray(11);
     v8.vertexAttrib4f(11, v60.x, v60.y, v60.z, v60.w);
     v60.buffer = null;
    }
    v61 = v0[12];
    if (v61.buffer) {
     v8.enableVertexAttribArray(12);
     v8.bindBuffer(34962, v61.buffer.buffer);
     v8.vertexAttribPointer(12, v61.size, v61.type, v61.normalized, v61.stride, v61.offset);
    }
    else {
     v8.disableVertexAttribArray(12);
     v8.vertexAttrib4f(12, v61.x, v61.y, v61.z, v61.w);
     v61.buffer = null;
    }
    v62 = v0[13];
    if (v62.buffer) {
     v8.enableVertexAttribArray(13);
     v8.bindBuffer(34962, v62.buffer.buffer);
     v8.vertexAttribPointer(13, v62.size, v62.type, v62.normalized, v62.stride, v62.offset);
    }
    else {
     v8.disableVertexAttribArray(13);
     v8.vertexAttrib4f(13, v62.x, v62.y, v62.z, v62.w);
     v62.buffer = null;
    }
    v63 = v0[14];
    if (v63.buffer) {
     v8.enableVertexAttribArray(14);
     v8.bindBuffer(34962, v63.buffer.buffer);
     v8.vertexAttribPointer(14, v63.size, v63.type, v63.normalized, v63.stride, v63.offset);
    }
    else {
     v8.disableVertexAttribArray(14);
     v8.vertexAttrib4f(14, v63.x, v63.y, v63.z, v63.w);
     v63.buffer = null;
    }
    v64 = v0[15];
    if (v64.buffer) {
     v8.enableVertexAttribArray(15);
     v8.bindBuffer(34962, v64.buffer.buffer);
     v8.vertexAttribPointer(15, v64.size, v64.type, v64.normalized, v64.stride, v64.offset);
    }
    else {
     v8.disableVertexAttribArray(15);
     v8.vertexAttrib4f(15, v64.x, v64.y, v64.z, v64.w);
     v64.buffer = null;
    }
    v15.currentVAO = null;
    v15.setVAO(v15.targetVAO);
    if (v65) {
     v8.enable(3042)
    }
    else {
     v8.disable(3042)
    }
    v3.blend_enable = v65;
    if (v66) {
     v8.enable(2884)
    }
    else {
     v8.disable(2884)
    }
    v3.cull_enable = v66;
    if (v67) {
     v8.enable(2929)
    }
    else {
     v8.disable(2929)
    }
    v3.depth_enable = v67;
    if (v68) {
     v8.enable(3024)
    }
    else {
     v8.disable(3024)
    }
    v3.dither = v68;
    if (v69) {
     v8.enable(32823)
    }
    else {
     v8.disable(32823)
    }
    v3.polygonOffset_enable = v69;
    if (v70) {
     v8.enable(32926)
    }
    else {
     v8.disable(32926)
    }
    v3.sample_alpha = v70;
    if (v71) {
     v8.enable(32928)
    }
    else {
     v8.disable(32928)
    }
    v3.sample_enable = v71;
    if (v72) {
     v8.enable(3089)
    }
    else {
     v8.disable(3089)
    }
    v3.scissor_enable = v72;
    if (v73) {
     v8.enable(2960)
    }
    else {
     v8.disable(2960)
    }
    v3.stencil_enable = v73;
    v8.blendColor(v74[0], v74[1], v74[2], v74[3]);
    v75[0] = v74[0];
    v75[1] = v74[1];
    v75[2] = v74[2];
    v75[3] = v74[3];
    v8.blendEquationSeparate(v76[0], v76[1]);
    v77[0] = v76[0];
    v77[1] = v76[1];
    v8.blendFuncSeparate(v78[0], v78[1], v78[2], v78[3]);
    v79[0] = v78[0];
    v79[1] = v78[1];
    v79[2] = v78[2];
    v79[3] = v78[3];
    v8.colorMask(v80[0], v80[1], v80[2], v80[3]);
    v81[0] = v80[0];
    v81[1] = v80[1];
    v81[2] = v80[2];
    v81[3] = v80[3];
    v8.cullFace(v82);
    v3.cull_face = v82;
    v8.depthFunc(v84);
    v3.depth_func = v84;
    v8.depthMask(v86);
    v3.depth_mask = v86;
    v8.depthRange(v88[0], v88[1]);
    v89[0] = v88[0];
    v89[1] = v88[1];
    v8.frontFace(v90);
    v3.frontFace = v90;
    v8.lineWidth(v92);
    v3.lineWidth = v92;
    v8.polygonOffset(v94[0], v94[1]);
    v95[0] = v94[0];
    v95[1] = v94[1];
    v8.sampleCoverage(v96[0], v96[1]);
    v97[0] = v96[0];
    v97[1] = v96[1];
    v8.scissor(v98[0], v98[1], v98[2], v98[3]);
    v99[0] = v98[0];
    v99[1] = v98[1];
    v99[2] = v98[2];
    v99[3] = v98[3];
    v8.stencilFunc(v100[0], v100[1], v100[2]);
    v101[0] = v100[0];
    v101[1] = v100[1];
    v101[2] = v100[2];
    v8.stencilMask(v102);
    v3.stencil_mask = v102;
    v8.stencilOpSeparate(v104[0], v104[1], v104[2], v104[3]);
    v105[0] = v104[0];
    v105[1] = v104[1];
    v105[2] = v104[2];
    v105[3] = v104[3];
    v8.stencilOpSeparate(v106[0], v106[1], v106[2], v106[3]);
    v107[0] = v106[0];
    v107[1] = v106[1];
    v107[2] = v106[2];
    v107[3] = v106[3];
    v8.viewport(v108[0], v108[1], v108[2], v108[3]);
    v109[0] = v108[0];
    v109[1] = v108[1];
    v109[2] = v108[2];
    v109[3] = v108[3];
   }
   ,
  }

 },
 '$3': function ($0, $1, $2, $3
 ) {
  'use strict';
  var v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15, v16, v17, v18, v19, v20, v21, v22, v23, v24, v25, v26, v27, v28, v29, v30, v31, v32, v33, v34, v35, v36, v37, v38, v39, v40, v41, v42, v43, v44, v45, v46, v108, v174;
  v0 = $0.attributes;
  v1 = $0.buffer;
  v2 = $0.context;
  v3 = $0.current;
  v4 = $0.draw;
  v5 = $0.elements;
  v6 = $0.extensions;
  v7 = $0.framebuffer;
  v8 = $0.gl;
  v9 = $0.isBufferArgs;
  v10 = $0.next;
  v11 = $0.shader;
  v12 = $0.strings;
  v13 = $0.timer;
  v14 = $0.uniforms;
  v15 = $0.vao;
  v16 = v10.blend_color;
  v17 = v3.blend_color;
  v18 = v10.blend_equation;
  v19 = v3.blend_equation;
  v20 = v10.blend_func;
  v21 = v3.blend_func;
  v22 = v10.colorMask;
  v23 = v3.colorMask;
  v24 = v10.depth_range;
  v25 = v3.depth_range;
  v26 = v10.polygonOffset_offset;
  v27 = v3.polygonOffset_offset;
  v28 = v10.sample_coverage;
  v29 = v3.sample_coverage;
  v30 = v10.scissor_box;
  v31 = v3.scissor_box;
  v32 = v10.stencil_func;
  v33 = v3.stencil_func;
  v34 = v10.stencil_opBack;
  v35 = v3.stencil_opBack;
  v36 = v10.stencil_opFront;
  v37 = v3.stencil_opFront;
  v38 = v10.viewport;
  v39 = v3.viewport;
  v40 = {
   'add': 32774, 'subtract': 32778, 'reverse subtract': 32779
  }
   ;
  v41 = {
   '0': 0, '1': 1, 'zero': 0, 'one': 1, 'src color': 768, 'one minus src color': 769, 'src alpha': 770, 'one minus src alpha': 771, 'dst color': 774, 'one minus dst color': 775, 'dst alpha': 772, 'one minus dst alpha': 773, 'constant color': 32769, 'one minus constant color': 32770, 'constant alpha': 32771, 'one minus constant alpha': 32772, 'src alpha saturate': 776
  }
   ;
  v42 = {
   'never': 512, 'less': 513, '<': 513, 'equal': 514, '=': 514, '==': 514, '===': 514, 'lequal': 515, '<=': 515, 'greater': 516, '>': 516, 'notequal': 517, '!=': 517, '!==': 517, 'gequal': 518, '>=': 518, 'always': 519
  }
   ;
  v43 = {
   'int8': 5120, 'int16': 5122, 'int32': 5124, 'uint8': 5121, 'uint16': 5123, 'uint32': 5125, 'float': 5126, 'float32': 5126
  }
   ;
  v44 = {
   'cw': 2304, 'ccw': 2305
  }
   ;
  v45 = {
   'points': 0, 'point': 0, 'lines': 1, 'line': 1, 'triangles': 4, 'triangle': 4, 'line loop': 2, 'line strip': 3, 'triangle strip': 5, 'triangle fan': 6
  }
   ;
  v46 = {
   '0': 0, 'zero': 0, 'keep': 7680, 'replace': 7681, 'increment': 7682, 'decrement': 7683, 'increment wrap': 34055, 'decrement wrap': 34056, 'invert': 5386
  }
   ;
  v108 = {
  }
   ;
  v174 = {
  }
   ;
  return {
   'batch': function (a0, a1) {
    var v113, v114, v169, v170, v171, v172, v173, v175, v176;
    v113 = v6.angle_instanced_arrays;
    v114 = v7.next;
    if (v114 !== v7.cur) {
     if (v114) {
      v8.bindFramebuffer(36160, v114.framebuffer);
     }
     else {
      v8.bindFramebuffer(36160, null);
     }
     v7.cur = v114;
    }
    if (v3.dirty) {
     var v115, v116, v117, v118, v119, v120, v121, v122, v123, v124, v125, v126, v127, v128, v129, v130, v131, v132, v133, v134, v135, v136, v137, v138, v139, v140, v141, v142, v143, v144, v145, v146, v147, v148, v149, v150, v151, v152, v153, v154, v155, v156, v157, v158, v159, v160, v161, v162, v163, v164, v165, v166, v167, v168;
     v115 = v10.dither;
     if (v115 !== v3.dither) {
      if (v115) {
       v8.enable(3024);
      }
      else {
       v8.disable(3024);
      }
      v3.dither = v115;
     }
     v116 = v10.blend_enable;
     if (v116 !== v3.blend_enable) {
      if (v116) {
       v8.enable(3042);
      }
      else {
       v8.disable(3042);
      }
      v3.blend_enable = v116;
     }
     v117 = v16[0];
     v118 = v16[1];
     v119 = v16[2];
     v120 = v16[3];
     if (v117 !== v17[0] || v118 !== v17[1] || v119 !== v17[2] || v120 !== v17[3]) {
      v8.blendColor(v117, v118, v119, v120);
      v17[0] = v117;
      v17[1] = v118;
      v17[2] = v119;
      v17[3] = v120;
     }
     v121 = v18[0];
     v122 = v18[1];
     if (v121 !== v19[0] || v122 !== v19[1]) {
      v8.blendEquationSeparate(v121, v122);
      v19[0] = v121;
      v19[1] = v122;
     }
     v123 = v20[0];
     v124 = v20[1];
     v125 = v20[2];
     v126 = v20[3];
     if (v123 !== v21[0] || v124 !== v21[1] || v125 !== v21[2] || v126 !== v21[3]) {
      v8.blendFuncSeparate(v123, v124, v125, v126);
      v21[0] = v123;
      v21[1] = v124;
      v21[2] = v125;
      v21[3] = v126;
     }
     v127 = v10.depth_enable;
     if (v127 !== v3.depth_enable) {
      if (v127) {
       v8.enable(2929);
      }
      else {
       v8.disable(2929);
      }
      v3.depth_enable = v127;
     }
     v128 = v10.depth_func;
     if (v128 !== v3.depth_func) {
      v8.depthFunc(v128);
      v3.depth_func = v128;
     }
     v129 = v24[0];
     v130 = v24[1];
     if (v129 !== v25[0] || v130 !== v25[1]) {
      v8.depthRange(v129, v130);
      v25[0] = v129;
      v25[1] = v130;
     }
     v131 = v10.depth_mask;
     if (v131 !== v3.depth_mask) {
      v8.depthMask(v131);
      v3.depth_mask = v131;
     }
     v132 = v22[0];
     v133 = v22[1];
     v134 = v22[2];
     v135 = v22[3];
     if (v132 !== v23[0] || v133 !== v23[1] || v134 !== v23[2] || v135 !== v23[3]) {
      v8.colorMask(v132, v133, v134, v135);
      v23[0] = v132;
      v23[1] = v133;
      v23[2] = v134;
      v23[3] = v135;
     }
     v136 = v10.cull_enable;
     if (v136 !== v3.cull_enable) {
      if (v136) {
       v8.enable(2884);
      }
      else {
       v8.disable(2884);
      }
      v3.cull_enable = v136;
     }
     v137 = v10.cull_face;
     if (v137 !== v3.cull_face) {
      v8.cullFace(v137);
      v3.cull_face = v137;
     }
     v138 = v10.frontFace;
     if (v138 !== v3.frontFace) {
      v8.frontFace(v138);
      v3.frontFace = v138;
     }
     v139 = v10.lineWidth;
     if (v139 !== v3.lineWidth) {
      v8.lineWidth(v139);
      v3.lineWidth = v139;
     }
     v140 = v10.polygonOffset_enable;
     if (v140 !== v3.polygonOffset_enable) {
      if (v140) {
       v8.enable(32823);
      }
      else {
       v8.disable(32823);
      }
      v3.polygonOffset_enable = v140;
     }
     v141 = v26[0];
     v142 = v26[1];
     if (v141 !== v27[0] || v142 !== v27[1]) {
      v8.polygonOffset(v141, v142);
      v27[0] = v141;
      v27[1] = v142;
     }
     v143 = v10.sample_alpha;
     if (v143 !== v3.sample_alpha) {
      if (v143) {
       v8.enable(32926);
      }
      else {
       v8.disable(32926);
      }
      v3.sample_alpha = v143;
     }
     v144 = v10.sample_enable;
     if (v144 !== v3.sample_enable) {
      if (v144) {
       v8.enable(32928);
      }
      else {
       v8.disable(32928);
      }
      v3.sample_enable = v144;
     }
     v145 = v28[0];
     v146 = v28[1];
     if (v145 !== v29[0] || v146 !== v29[1]) {
      v8.sampleCoverage(v145, v146);
      v29[0] = v145;
      v29[1] = v146;
     }
     v147 = v10.stencil_enable;
     if (v147 !== v3.stencil_enable) {
      if (v147) {
       v8.enable(2960);
      }
      else {
       v8.disable(2960);
      }
      v3.stencil_enable = v147;
     }
     v148 = v10.stencil_mask;
     if (v148 !== v3.stencil_mask) {
      v8.stencilMask(v148);
      v3.stencil_mask = v148;
     }
     v149 = v32[0];
     v150 = v32[1];
     v151 = v32[2];
     if (v149 !== v33[0] || v150 !== v33[1] || v151 !== v33[2]) {
      v8.stencilFunc(v149, v150, v151);
      v33[0] = v149;
      v33[1] = v150;
      v33[2] = v151;
     }
     v152 = v36[0];
     v153 = v36[1];
     v154 = v36[2];
     v155 = v36[3];
     if (v152 !== v37[0] || v153 !== v37[1] || v154 !== v37[2] || v155 !== v37[3]) {
      v8.stencilOpSeparate(v152, v153, v154, v155);
      v37[0] = v152;
      v37[1] = v153;
      v37[2] = v154;
      v37[3] = v155;
     }
     v156 = v34[0];
     v157 = v34[1];
     v158 = v34[2];
     v159 = v34[3];
     if (v156 !== v35[0] || v157 !== v35[1] || v158 !== v35[2] || v159 !== v35[3]) {
      v8.stencilOpSeparate(v156, v157, v158, v159);
      v35[0] = v156;
      v35[1] = v157;
      v35[2] = v158;
      v35[3] = v159;
     }
     v160 = v10.scissor_enable;
     if (v160 !== v3.scissor_enable) {
      if (v160) {
       v8.enable(3089);
      }
      else {
       v8.disable(3089);
      }
      v3.scissor_enable = v160;
     }
     v161 = v30[0];
     v162 = v30[1];
     v163 = v30[2];
     v164 = v30[3];
     if (v161 !== v31[0] || v162 !== v31[1] || v163 !== v31[2] || v164 !== v31[3]) {
      v8.scissor(v161, v162, v163, v164);
      v31[0] = v161;
      v31[1] = v162;
      v31[2] = v163;
      v31[3] = v164;
     }
     v165 = v38[0];
     v166 = v38[1];
     v167 = v38[2];
     v168 = v38[3];
     if (v165 !== v39[0] || v166 !== v39[1] || v167 !== v39[2] || v168 !== v39[3]) {
      v8.viewport(v165, v166, v167, v168);
      v39[0] = v165;
      v39[1] = v166;
      v39[2] = v167;
      v39[3] = v168;
     }
     v3.dirty = false;
    }
    v169 = v3.profile;
    if (v169) {
     v170 = performance.now();
     $1.count += a1;
    }
    v171 = v11.frag;
    v172 = v11.vert;
    v173 = v11.program(v172, v171);
    v8.useProgram(v173.program);
    v15.setVAO(null);
    v175 = v173.id;
    v176 = v174[v175];
    if (v176) {
     v176.call(this, a0, a1);
    }
    else {
     v176 = v174[v175] = $3(v173);
     v176.call(this, a0, a1);
    }
    v15.setVAO(null);
    if (v169) {
     $1.cpuTime += performance.now() - v170;
    }
   }
   , 'draw': function (a0) {
    var v47, v48, v103, v104, v105, v106, v107, v109, v110;
    v47 = v6.angle_instanced_arrays;
    v48 = v7.next;
    if (v48 !== v7.cur) {
     if (v48) {
      v8.bindFramebuffer(36160, v48.framebuffer);
     }
     else {
      v8.bindFramebuffer(36160, null);
     }
     v7.cur = v48;
    }
    if (v3.dirty) {
     var v49, v50, v51, v52, v53, v54, v55, v56, v57, v58, v59, v60, v61, v62, v63, v64, v65, v66, v67, v68, v69, v70, v71, v72, v73, v74, v75, v76, v77, v78, v79, v80, v81, v82, v83, v84, v85, v86, v87, v88, v89, v90, v91, v92, v93, v94, v95, v96, v97, v98, v99, v100, v101, v102;
     v49 = v10.dither;
     if (v49 !== v3.dither) {
      if (v49) {
       v8.enable(3024);
      }
      else {
       v8.disable(3024);
      }
      v3.dither = v49;
     }
     v50 = v10.blend_enable;
     if (v50 !== v3.blend_enable) {
      if (v50) {
       v8.enable(3042);
      }
      else {
       v8.disable(3042);
      }
      v3.blend_enable = v50;
     }
     v51 = v16[0];
     v52 = v16[1];
     v53 = v16[2];
     v54 = v16[3];
     if (v51 !== v17[0] || v52 !== v17[1] || v53 !== v17[2] || v54 !== v17[3]) {
      v8.blendColor(v51, v52, v53, v54);
      v17[0] = v51;
      v17[1] = v52;
      v17[2] = v53;
      v17[3] = v54;
     }
     v55 = v18[0];
     v56 = v18[1];
     if (v55 !== v19[0] || v56 !== v19[1]) {
      v8.blendEquationSeparate(v55, v56);
      v19[0] = v55;
      v19[1] = v56;
     }
     v57 = v20[0];
     v58 = v20[1];
     v59 = v20[2];
     v60 = v20[3];
     if (v57 !== v21[0] || v58 !== v21[1] || v59 !== v21[2] || v60 !== v21[3]) {
      v8.blendFuncSeparate(v57, v58, v59, v60);
      v21[0] = v57;
      v21[1] = v58;
      v21[2] = v59;
      v21[3] = v60;
     }
     v61 = v10.depth_enable;
     if (v61 !== v3.depth_enable) {
      if (v61) {
       v8.enable(2929);
      }
      else {
       v8.disable(2929);
      }
      v3.depth_enable = v61;
     }
     v62 = v10.depth_func;
     if (v62 !== v3.depth_func) {
      v8.depthFunc(v62);
      v3.depth_func = v62;
     }
     v63 = v24[0];
     v64 = v24[1];
     if (v63 !== v25[0] || v64 !== v25[1]) {
      v8.depthRange(v63, v64);
      v25[0] = v63;
      v25[1] = v64;
     }
     v65 = v10.depth_mask;
     if (v65 !== v3.depth_mask) {
      v8.depthMask(v65);
      v3.depth_mask = v65;
     }
     v66 = v22[0];
     v67 = v22[1];
     v68 = v22[2];
     v69 = v22[3];
     if (v66 !== v23[0] || v67 !== v23[1] || v68 !== v23[2] || v69 !== v23[3]) {
      v8.colorMask(v66, v67, v68, v69);
      v23[0] = v66;
      v23[1] = v67;
      v23[2] = v68;
      v23[3] = v69;
     }
     v70 = v10.cull_enable;
     if (v70 !== v3.cull_enable) {
      if (v70) {
       v8.enable(2884);
      }
      else {
       v8.disable(2884);
      }
      v3.cull_enable = v70;
     }
     v71 = v10.cull_face;
     if (v71 !== v3.cull_face) {
      v8.cullFace(v71);
      v3.cull_face = v71;
     }
     v72 = v10.frontFace;
     if (v72 !== v3.frontFace) {
      v8.frontFace(v72);
      v3.frontFace = v72;
     }
     v73 = v10.lineWidth;
     if (v73 !== v3.lineWidth) {
      v8.lineWidth(v73);
      v3.lineWidth = v73;
     }
     v74 = v10.polygonOffset_enable;
     if (v74 !== v3.polygonOffset_enable) {
      if (v74) {
       v8.enable(32823);
      }
      else {
       v8.disable(32823);
      }
      v3.polygonOffset_enable = v74;
     }
     v75 = v26[0];
     v76 = v26[1];
     if (v75 !== v27[0] || v76 !== v27[1]) {
      v8.polygonOffset(v75, v76);
      v27[0] = v75;
      v27[1] = v76;
     }
     v77 = v10.sample_alpha;
     if (v77 !== v3.sample_alpha) {
      if (v77) {
       v8.enable(32926);
      }
      else {
       v8.disable(32926);
      }
      v3.sample_alpha = v77;
     }
     v78 = v10.sample_enable;
     if (v78 !== v3.sample_enable) {
      if (v78) {
       v8.enable(32928);
      }
      else {
       v8.disable(32928);
      }
      v3.sample_enable = v78;
     }
     v79 = v28[0];
     v80 = v28[1];
     if (v79 !== v29[0] || v80 !== v29[1]) {
      v8.sampleCoverage(v79, v80);
      v29[0] = v79;
      v29[1] = v80;
     }
     v81 = v10.stencil_enable;
     if (v81 !== v3.stencil_enable) {
      if (v81) {
       v8.enable(2960);
      }
      else {
       v8.disable(2960);
      }
      v3.stencil_enable = v81;
     }
     v82 = v10.stencil_mask;
     if (v82 !== v3.stencil_mask) {
      v8.stencilMask(v82);
      v3.stencil_mask = v82;
     }
     v83 = v32[0];
     v84 = v32[1];
     v85 = v32[2];
     if (v83 !== v33[0] || v84 !== v33[1] || v85 !== v33[2]) {
      v8.stencilFunc(v83, v84, v85);
      v33[0] = v83;
      v33[1] = v84;
      v33[2] = v85;
     }
     v86 = v36[0];
     v87 = v36[1];
     v88 = v36[2];
     v89 = v36[3];
     if (v86 !== v37[0] || v87 !== v37[1] || v88 !== v37[2] || v89 !== v37[3]) {
      v8.stencilOpSeparate(v86, v87, v88, v89);
      v37[0] = v86;
      v37[1] = v87;
      v37[2] = v88;
      v37[3] = v89;
     }
     v90 = v34[0];
     v91 = v34[1];
     v92 = v34[2];
     v93 = v34[3];
     if (v90 !== v35[0] || v91 !== v35[1] || v92 !== v35[2] || v93 !== v35[3]) {
      v8.stencilOpSeparate(v90, v91, v92, v93);
      v35[0] = v90;
      v35[1] = v91;
      v35[2] = v92;
      v35[3] = v93;
     }
     v94 = v10.scissor_enable;
     if (v94 !== v3.scissor_enable) {
      if (v94) {
       v8.enable(3089);
      }
      else {
       v8.disable(3089);
      }
      v3.scissor_enable = v94;
     }
     v95 = v30[0];
     v96 = v30[1];
     v97 = v30[2];
     v98 = v30[3];
     if (v95 !== v31[0] || v96 !== v31[1] || v97 !== v31[2] || v98 !== v31[3]) {
      v8.scissor(v95, v96, v97, v98);
      v31[0] = v95;
      v31[1] = v96;
      v31[2] = v97;
      v31[3] = v98;
     }
     v99 = v38[0];
     v100 = v38[1];
     v101 = v38[2];
     v102 = v38[3];
     if (v99 !== v39[0] || v100 !== v39[1] || v101 !== v39[2] || v102 !== v39[3]) {
      v8.viewport(v99, v100, v101, v102);
      v39[0] = v99;
      v39[1] = v100;
      v39[2] = v101;
      v39[3] = v102;
     }
     v3.dirty = false;
    }
    v103 = v3.profile;
    if (v103) {
     v104 = performance.now();
     $1.count++;
    }
    v105 = v11.frag;
    v106 = v11.vert;
    v107 = v11.program(v106, v105);
    v8.useProgram(v107.program);
    v15.setVAO(null);
    v109 = v107.id;
    v110 = v108[v109];
    if (v110) {
     v110.call(this, a0);
    }
    else {
     v110 = v108[v109] = $2(v107);
     v110.call(this, a0);
    }
    v15.setVAO(null);
    if (v103) {
     $1.cpuTime += performance.now() - v104;
    }
   }
   , 'scope': function (a0, a1, a2) {
    var v111, v112;
    v111 = v3.profile;
    if (v111) {
     v112 = performance.now();
     $1.count++;
    }
    a1(v2, a0, a2);
    if (v111) {
     $1.cpuTime += performance.now() - v112;
    }
   }
   ,
  }

 },
 '$38,colors,contextColor,dim0A,dim0B,dim0C,dim0D,dim1A,dim1B,dim1C,dim1D,drwLayer,hiA,hiB,hiC,hiD,loA,loB,loC,loD,maskHeight,maskTexture,p01_04,p05_08,p09_12,p13_16,p17_20,p21_24,p25_28,p29_32,p33_36,p37_40,p41_44,p45_48,p49_52,p53_56,p57_60,palette,resolution,viewBoxPos,viewBoxSize': function ($0, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, colors, contextColor, dim0A, dim0B, dim0C, dim0D, dim1A, dim1B, dim1C, dim1D, drwLayer, hiA, hiB, hiC, hiD, loA, loB, loC, loD, maskHeight, maskTexture, p01_04, p05_08, p09_12, p13_16, p17_20, p21_24, p25_28, p29_32, p33_36, p37_40, p41_44, p45_48, p49_52, p53_56, p57_60, palette, resolution, viewBoxPos, viewBoxSize
 ) {
  'use strict';
  var v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15, v16, v17, v18, v19, v20, v21, v22, v23, v24, v25, v26, v27, v28, v29, v30, v31, v32, v33, v34, v35, v36, v37, v38, v39, v40, v41, v42, v43, v44, v45, v46, v47, v48, v127, v129, v131, v133, v135, v137, v139, v141, v143, v145, v147, v149, v151, v153, v155, v157, v553, v555, v557, v559, v561, v563, v565, v567, v569, v571, v573, v575, v577, v579, v581, v583;
  v0 = $0.attributes;
  v1 = $0.buffer;
  v2 = $0.context;
  v3 = $0.current;
  v4 = $0.draw;
  v5 = $0.elements;
  v6 = $0.extensions;
  v7 = $0.framebuffer;
  v8 = $0.gl;
  v9 = $0.isBufferArgs;
  v10 = $0.next;
  v11 = $0.shader;
  v12 = $0.strings;
  v13 = $0.timer;
  v14 = $0.uniforms;
  v15 = $0.vao;
  v16 = v10.blend_color;
  v17 = v3.blend_color;
  v18 = v10.blend_equation;
  v19 = v3.blend_equation;
  v20 = v10.blend_func;
  v21 = v3.blend_func;
  v22 = v10.colorMask;
  v23 = v3.colorMask;
  v24 = v10.depth_range;
  v25 = v3.depth_range;
  v26 = v10.polygonOffset_offset;
  v27 = v3.polygonOffset_offset;
  v28 = v10.sample_coverage;
  v29 = v3.sample_coverage;
  v30 = v10.scissor_box;
  v31 = v3.scissor_box;
  v32 = v10.stencil_func;
  v33 = v3.stencil_func;
  v34 = v10.stencil_opBack;
  v35 = v3.stencil_opBack;
  v36 = v10.stencil_opFront;
  v37 = v3.stencil_opFront;
  v38 = v10.viewport;
  v39 = v3.viewport;
  v40 = {
   'add': 32774, 'subtract': 32778, 'reverse subtract': 32779
  }
   ;
  v41 = {
   '0': 0, '1': 1, 'zero': 0, 'one': 1, 'src color': 768, 'one minus src color': 769, 'src alpha': 770, 'one minus src alpha': 771, 'dst color': 774, 'one minus dst color': 775, 'dst alpha': 772, 'one minus dst alpha': 773, 'constant color': 32769, 'one minus constant color': 32770, 'constant alpha': 32771, 'one minus constant alpha': 32772, 'src alpha saturate': 776
  }
   ;
  v42 = {
   'never': 512, 'less': 513, '<': 513, 'equal': 514, '=': 514, '==': 514, '===': 514, 'lequal': 515, '<=': 515, 'greater': 516, '>': 516, 'notequal': 517, '!=': 517, '!==': 517, 'gequal': 518, '>=': 518, 'always': 519
  }
   ;
  v43 = {
   'int8': 5120, 'int16': 5122, 'int32': 5124, 'uint8': 5121, 'uint16': 5123, 'uint32': 5125, 'float': 5126, 'float32': 5126
  }
   ;
  v44 = {
   'cw': 2304, 'ccw': 2305
  }
   ;
  v45 = {
   'points': 0, 'point': 0, 'lines': 1, 'line': 1, 'triangles': 4, 'triangle': 4, 'line loop': 2, 'line strip': 3, 'triangle strip': 5, 'triangle fan': 6
  }
   ;
  v46 = {
   '0': 0, 'zero': 0, 'keep': 7680, 'replace': 7681, 'increment': 7682, 'decrement': 7683, 'increment wrap': 34055, 'decrement wrap': 34056, 'invert': 5386
  }
   ;
  v47 = {
  }
   ;
  v48 = {
  }
   ;
  v127 = new Float32Array(16);
  v129 = new Float32Array(16);
  v131 = new Float32Array(16);
  v133 = new Float32Array(16);
  v135 = new Float32Array(16);
  v137 = new Float32Array(16);
  v139 = new Float32Array(16);
  v141 = new Float32Array(16);
  v143 = new Float32Array(16);
  v145 = new Float32Array(16);
  v147 = new Float32Array(16);
  v149 = new Float32Array(16);
  v151 = new Float32Array(16);
  v153 = new Float32Array(16);
  v155 = new Float32Array(16);
  v157 = new Float32Array(16);
  v553 = new Float32Array(16);
  v555 = new Float32Array(16);
  v557 = new Float32Array(16);
  v559 = new Float32Array(16);
  v561 = new Float32Array(16);
  v563 = new Float32Array(16);
  v565 = new Float32Array(16);
  v567 = new Float32Array(16);
  v569 = new Float32Array(16);
  v571 = new Float32Array(16);
  v573 = new Float32Array(16);
  v575 = new Float32Array(16);
  v577 = new Float32Array(16);
  v579 = new Float32Array(16);
  v581 = new Float32Array(16);
  v583 = new Float32Array(16);
  return {
   'batch': function (a0, a1) {
    var v473, v499, v500, v501;
    v473 = v7.next;
    if (v473 !== v7.cur) {
     if (v473) {
      v8.bindFramebuffer(36160, v473.framebuffer);
     }
     else {
      v8.bindFramebuffer(36160, null);
     }
     v7.cur = v473;
    }
    if (v3.dirty) {
     var v474, v475, v476, v477, v478, v479, v480, v481, v482, v483, v484, v485, v486, v487, v488, v489, v490, v491, v492, v493, v494, v495, v496, v497, v498;
     v474 = v22[0];
     v475 = v22[1];
     v476 = v22[2];
     v477 = v22[3];
     if (v474 !== v23[0] || v475 !== v23[1] || v476 !== v23[2] || v477 !== v23[3]) {
      v8.colorMask(v474, v475, v476, v477);
      v23[0] = v474;
      v23[1] = v475;
      v23[2] = v476;
      v23[3] = v477;
     }
     v478 = v10.frontFace;
     if (v478 !== v3.frontFace) {
      v8.frontFace(v478);
      v3.frontFace = v478;
     }
     v479 = v10.polygonOffset_enable;
     if (v479 !== v3.polygonOffset_enable) {
      if (v479) {
       v8.enable(32823);
      }
      else {
       v8.disable(32823);
      }
      v3.polygonOffset_enable = v479;
     }
     v480 = v26[0];
     v481 = v26[1];
     if (v480 !== v27[0] || v481 !== v27[1]) {
      v8.polygonOffset(v480, v481);
      v27[0] = v480;
      v27[1] = v481;
     }
     v482 = v10.sample_alpha;
     if (v482 !== v3.sample_alpha) {
      if (v482) {
       v8.enable(32926);
      }
      else {
       v8.disable(32926);
      }
      v3.sample_alpha = v482;
     }
     v483 = v10.sample_enable;
     if (v483 !== v3.sample_enable) {
      if (v483) {
       v8.enable(32928);
      }
      else {
       v8.disable(32928);
      }
      v3.sample_enable = v483;
     }
     v484 = v28[0];
     v485 = v28[1];
     if (v484 !== v29[0] || v485 !== v29[1]) {
      v8.sampleCoverage(v484, v485);
      v29[0] = v484;
      v29[1] = v485;
     }
     v486 = v10.stencil_enable;
     if (v486 !== v3.stencil_enable) {
      if (v486) {
       v8.enable(2960);
      }
      else {
       v8.disable(2960);
      }
      v3.stencil_enable = v486;
     }
     v487 = v10.stencil_mask;
     if (v487 !== v3.stencil_mask) {
      v8.stencilMask(v487);
      v3.stencil_mask = v487;
     }
     v488 = v32[0];
     v489 = v32[1];
     v490 = v32[2];
     if (v488 !== v33[0] || v489 !== v33[1] || v490 !== v33[2]) {
      v8.stencilFunc(v488, v489, v490);
      v33[0] = v488;
      v33[1] = v489;
      v33[2] = v490;
     }
     v491 = v36[0];
     v492 = v36[1];
     v493 = v36[2];
     v494 = v36[3];
     if (v491 !== v37[0] || v492 !== v37[1] || v493 !== v37[2] || v494 !== v37[3]) {
      v8.stencilOpSeparate(v491, v492, v493, v494);
      v37[0] = v491;
      v37[1] = v492;
      v37[2] = v493;
      v37[3] = v494;
     }
     v495 = v34[0];
     v496 = v34[1];
     v497 = v34[2];
     v498 = v34[3];
     if (v495 !== v35[0] || v496 !== v35[1] || v497 !== v35[2] || v498 !== v35[3]) {
      v8.stencilOpSeparate(v495, v496, v497, v498);
      v35[0] = v495;
      v35[1] = v496;
      v35[2] = v497;
      v35[3] = v498;
     }
    }
    v8.blendColor(0, 0, 0, 0);
    v17[0] = 0;
    v17[1] = 0;
    v17[2] = 0;
    v17[3] = 0;
    v8.disable(3042);
    v3.blend_enable = false;
    v8.blendEquationSeparate(32774, 32774);
    v19[0] = 32774;
    v19[1] = 32774;
    v8.blendFuncSeparate(770, 771, 1, 1);
    v21[0] = 770;
    v21[1] = 771;
    v21[2] = 1;
    v21[3] = 1;
    v8.enable(2884);
    v3.cull_enable = true;
    v8.cullFace(1029);
    v3.cull_face = 1029;
    v8.enable(2929);
    v3.depth_enable = true;
    v8.depthFunc(513);
    v3.depth_func = 513;
    v8.depthMask(true);
    v3.depth_mask = true;
    v8.depthRange(0, 1);
    v25[0] = 0;
    v25[1] = 1;
    v8.disable(3024);
    v3.dither = false;
    v8.lineWidth(2);
    v3.lineWidth = 2;
    v8.enable(3089);
    v3.scissor_enable = true;
    v499 = v3.profile;
    v3.profile = false;
    v8.useProgram($37.program);
    var v520, v521, v522, v523, v524, v525, v526, v527, v528, v529, v530, v531, v532, v533, v534, v535, v536, v537, v538, v539, v540, v541, v542, v543, v544, v545, v546, v547, v548, v549, v550, v551, v614;
    v15.setVAO(null);
    v520 = p01_04.location;
    v521 = v0[v520];
    if (!v521.buffer) {
     v8.enableVertexAttribArray(v520);
    }
    if (v521.type !== $3.dtype || v521.size !== 4 || v521.buffer !== $3 || v521.normalized !== false || v521.offset !== 0 || v521.stride !== 0) {
     v8.bindBuffer(34962, $3.buffer);
     v8.vertexAttribPointer(v520, 4, $3.dtype, false, 0, 0);
     v521.type = $3.dtype;
     v521.size = 4;
     v521.buffer = $3;
     v521.normalized = false;
     v521.offset = 0;
     v521.stride = 0;
    }
    v522 = p05_08.location;
    v523 = v0[v522];
    if (!v523.buffer) {
     v8.enableVertexAttribArray(v522);
    }
    if (v523.type !== $4.dtype || v523.size !== 4 || v523.buffer !== $4 || v523.normalized !== false || v523.offset !== 0 || v523.stride !== 0) {
     v8.bindBuffer(34962, $4.buffer);
     v8.vertexAttribPointer(v522, 4, $4.dtype, false, 0, 0);
     v523.type = $4.dtype;
     v523.size = 4;
     v523.buffer = $4;
     v523.normalized = false;
     v523.offset = 0;
     v523.stride = 0;
    }
    v524 = p09_12.location;
    v525 = v0[v524];
    if (!v525.buffer) {
     v8.enableVertexAttribArray(v524);
    }
    if (v525.type !== $5.dtype || v525.size !== 4 || v525.buffer !== $5 || v525.normalized !== false || v525.offset !== 0 || v525.stride !== 0) {
     v8.bindBuffer(34962, $5.buffer);
     v8.vertexAttribPointer(v524, 4, $5.dtype, false, 0, 0);
     v525.type = $5.dtype;
     v525.size = 4;
     v525.buffer = $5;
     v525.normalized = false;
     v525.offset = 0;
     v525.stride = 0;
    }
    v526 = p13_16.location;
    v527 = v0[v526];
    if (!v527.buffer) {
     v8.enableVertexAttribArray(v526);
    }
    if (v527.type !== $6.dtype || v527.size !== 4 || v527.buffer !== $6 || v527.normalized !== false || v527.offset !== 0 || v527.stride !== 0) {
     v8.bindBuffer(34962, $6.buffer);
     v8.vertexAttribPointer(v526, 4, $6.dtype, false, 0, 0);
     v527.type = $6.dtype;
     v527.size = 4;
     v527.buffer = $6;
     v527.normalized = false;
     v527.offset = 0;
     v527.stride = 0;
    }
    v528 = p17_20.location;
    v529 = v0[v528];
    if (!v529.buffer) {
     v8.enableVertexAttribArray(v528);
    }
    if (v529.type !== $7.dtype || v529.size !== 4 || v529.buffer !== $7 || v529.normalized !== false || v529.offset !== 0 || v529.stride !== 0) {
     v8.bindBuffer(34962, $7.buffer);
     v8.vertexAttribPointer(v528, 4, $7.dtype, false, 0, 0);
     v529.type = $7.dtype;
     v529.size = 4;
     v529.buffer = $7;
     v529.normalized = false;
     v529.offset = 0;
     v529.stride = 0;
    }
    v530 = p21_24.location;
    v531 = v0[v530];
    if (!v531.buffer) {
     v8.enableVertexAttribArray(v530);
    }
    if (v531.type !== $8.dtype || v531.size !== 4 || v531.buffer !== $8 || v531.normalized !== false || v531.offset !== 0 || v531.stride !== 0) {
     v8.bindBuffer(34962, $8.buffer);
     v8.vertexAttribPointer(v530, 4, $8.dtype, false, 0, 0);
     v531.type = $8.dtype;
     v531.size = 4;
     v531.buffer = $8;
     v531.normalized = false;
     v531.offset = 0;
     v531.stride = 0;
    }
    v532 = p25_28.location;
    v533 = v0[v532];
    if (!v533.buffer) {
     v8.enableVertexAttribArray(v532);
    }
    if (v533.type !== $9.dtype || v533.size !== 4 || v533.buffer !== $9 || v533.normalized !== false || v533.offset !== 0 || v533.stride !== 0) {
     v8.bindBuffer(34962, $9.buffer);
     v8.vertexAttribPointer(v532, 4, $9.dtype, false, 0, 0);
     v533.type = $9.dtype;
     v533.size = 4;
     v533.buffer = $9;
     v533.normalized = false;
     v533.offset = 0;
     v533.stride = 0;
    }
    v534 = p29_32.location;
    v535 = v0[v534];
    if (!v535.buffer) {
     v8.enableVertexAttribArray(v534);
    }
    if (v535.type !== $10.dtype || v535.size !== 4 || v535.buffer !== $10 || v535.normalized !== false || v535.offset !== 0 || v535.stride !== 0) {
     v8.bindBuffer(34962, $10.buffer);
     v8.vertexAttribPointer(v534, 4, $10.dtype, false, 0, 0);
     v535.type = $10.dtype;
     v535.size = 4;
     v535.buffer = $10;
     v535.normalized = false;
     v535.offset = 0;
     v535.stride = 0;
    }
    v536 = p33_36.location;
    v537 = v0[v536];
    if (!v537.buffer) {
     v8.enableVertexAttribArray(v536);
    }
    if (v537.type !== $11.dtype || v537.size !== 4 || v537.buffer !== $11 || v537.normalized !== false || v537.offset !== 0 || v537.stride !== 0) {
     v8.bindBuffer(34962, $11.buffer);
     v8.vertexAttribPointer(v536, 4, $11.dtype, false, 0, 0);
     v537.type = $11.dtype;
     v537.size = 4;
     v537.buffer = $11;
     v537.normalized = false;
     v537.offset = 0;
     v537.stride = 0;
    }
    v538 = p37_40.location;
    v539 = v0[v538];
    if (!v539.buffer) {
     v8.enableVertexAttribArray(v538);
    }
    if (v539.type !== $12.dtype || v539.size !== 4 || v539.buffer !== $12 || v539.normalized !== false || v539.offset !== 0 || v539.stride !== 0) {
     v8.bindBuffer(34962, $12.buffer);
     v8.vertexAttribPointer(v538, 4, $12.dtype, false, 0, 0);
     v539.type = $12.dtype;
     v539.size = 4;
     v539.buffer = $12;
     v539.normalized = false;
     v539.offset = 0;
     v539.stride = 0;
    }
    v540 = p41_44.location;
    v541 = v0[v540];
    if (!v541.buffer) {
     v8.enableVertexAttribArray(v540);
    }
    if (v541.type !== $13.dtype || v541.size !== 4 || v541.buffer !== $13 || v541.normalized !== false || v541.offset !== 0 || v541.stride !== 0) {
     v8.bindBuffer(34962, $13.buffer);
     v8.vertexAttribPointer(v540, 4, $13.dtype, false, 0, 0);
     v541.type = $13.dtype;
     v541.size = 4;
     v541.buffer = $13;
     v541.normalized = false;
     v541.offset = 0;
     v541.stride = 0;
    }
    v542 = p45_48.location;
    v543 = v0[v542];
    if (!v543.buffer) {
     v8.enableVertexAttribArray(v542);
    }
    if (v543.type !== $14.dtype || v543.size !== 4 || v543.buffer !== $14 || v543.normalized !== false || v543.offset !== 0 || v543.stride !== 0) {
     v8.bindBuffer(34962, $14.buffer);
     v8.vertexAttribPointer(v542, 4, $14.dtype, false, 0, 0);
     v543.type = $14.dtype;
     v543.size = 4;
     v543.buffer = $14;
     v543.normalized = false;
     v543.offset = 0;
     v543.stride = 0;
    }
    v544 = p49_52.location;
    v545 = v0[v544];
    if (!v545.buffer) {
     v8.enableVertexAttribArray(v544);
    }
    if (v545.type !== $15.dtype || v545.size !== 4 || v545.buffer !== $15 || v545.normalized !== false || v545.offset !== 0 || v545.stride !== 0) {
     v8.bindBuffer(34962, $15.buffer);
     v8.vertexAttribPointer(v544, 4, $15.dtype, false, 0, 0);
     v545.type = $15.dtype;
     v545.size = 4;
     v545.buffer = $15;
     v545.normalized = false;
     v545.offset = 0;
     v545.stride = 0;
    }
    v546 = p53_56.location;
    v547 = v0[v546];
    if (!v547.buffer) {
     v8.enableVertexAttribArray(v546);
    }
    if (v547.type !== $16.dtype || v547.size !== 4 || v547.buffer !== $16 || v547.normalized !== false || v547.offset !== 0 || v547.stride !== 0) {
     v8.bindBuffer(34962, $16.buffer);
     v8.vertexAttribPointer(v546, 4, $16.dtype, false, 0, 0);
     v547.type = $16.dtype;
     v547.size = 4;
     v547.buffer = $16;
     v547.normalized = false;
     v547.offset = 0;
     v547.stride = 0;
    }
    v548 = p57_60.location;
    v549 = v0[v548];
    if (!v549.buffer) {
     v8.enableVertexAttribArray(v548);
    }
    if (v549.type !== $17.dtype || v549.size !== 4 || v549.buffer !== $17 || v549.normalized !== false || v549.offset !== 0 || v549.stride !== 0) {
     v8.bindBuffer(34962, $17.buffer);
     v8.vertexAttribPointer(v548, 4, $17.dtype, false, 0, 0);
     v549.type = $17.dtype;
     v549.size = 4;
     v549.buffer = $17;
     v549.normalized = false;
     v549.offset = 0;
     v549.stride = 0;
    }
    v550 = colors.location;
    v551 = v0[v550];
    if (!v551.buffer) {
     v8.enableVertexAttribArray(v550);
    }
    if (v551.type !== $18.dtype || v551.size !== 4 || v551.buffer !== $18 || v551.normalized !== false || v551.offset !== 0 || v551.stride !== 0) {
     v8.bindBuffer(34962, $18.buffer);
     v8.vertexAttribPointer(v550, 4, $18.dtype, false, 0, 0);
     v551.type = $18.dtype;
     v551.size = 4;
     v551.buffer = $18;
     v551.normalized = false;
     v551.offset = 0;
     v551.stride = 0;
    }
    v8.uniform1i(palette.location, $38.bind());
    v614 = v4.elements;
    if (v614) {
     v8.bindBuffer(34963, v614.buffer.buffer);
    }
    else if (v15.currentVAO) {
     v614 = v5.getElements(v15.currentVAO.elements);
     if (v614) v8.bindBuffer(34963, v614.buffer.buffer);
    }
    for (v500 = 0;
     v500 < a1;
     ++v500) {
     v501 = a0[v500];
     var v502, v503, v504, v505, v506, v507, v508, v509, v510, v511, v512, v513, v514, v515, v516, v517, v518, v519, v552, v554, v556, v558, v560, v562, v564, v566, v568, v570, v572, v574, v576, v578, v580, v582, v584, v585, v586, v587, v588, v589, v590, v591, v592, v593, v594, v595, v596, v597, v598, v599, v600, v601, v602, v603, v604, v605, v606, v607, v608, v609, v610, v611, v612, v613, v615, v616;
     v502 = v501['viewportHeight'];
     v47.height = v502;
     v503 = v501['viewportWidth'];
     v47.width = v503;
     v504 = v501['viewportX'];
     v47.x = v504;
     v505 = v501['viewportY'];
     v47.y = v505;
     v506 = v47.x | 0;
     v507 = v47.y | 0;
     v508 = 'width' in v47 ? v47.width | 0 : (v2.framebufferWidth - v506);
     v509 = 'height' in v47 ? v47.height | 0 : (v2.framebufferHeight - v507);
     v510 = v2.viewportWidth;
     v2.viewportWidth = v508;
     v511 = v2.viewportHeight;
     v2.viewportHeight = v509;
     v8.viewport(v506, v507, v508, v509);
     v39[0] = v506;
     v39[1] = v507;
     v39[2] = v508;
     v39[3] = v509;
     v512 = v501['scissorHeight'];
     v48.height = v512;
     v513 = v501['scissorWidth'];
     v48.width = v513;
     v514 = v501['scissorX'];
     v48.x = v514;
     v515 = v501['scissorY'];
     v48.y = v515;
     v516 = v48.x | 0;
     v517 = v48.y | 0;
     v518 = 'width' in v48 ? v48.width | 0 : (v2.framebufferWidth - v516);
     v519 = 'height' in v48 ? v48.height | 0 : (v2.framebufferHeight - v517);
     v8.scissor(v516, v517, v518, v519);
     v31[0] = v516;
     v31[1] = v517;
     v31[2] = v518;
     v31[3] = v519;
     v552 = v501['dim0A'];
     v8.uniformMatrix4fv(dim0A.location, false, (Array.isArray(v552) || v552 instanceof Float32Array) ? v552 : (v553[0] = v552[0], v553[1] = v552[1], v553[2] = v552[2], v553[3] = v552[3], v553[4] = v552[4], v553[5] = v552[5], v553[6] = v552[6], v553[7] = v552[7], v553[8] = v552[8], v553[9] = v552[9], v553[10] = v552[10], v553[11] = v552[11], v553[12] = v552[12], v553[13] = v552[13], v553[14] = v552[14], v553[15] = v552[15], v553));
     v554 = v501['dim1A'];
     v8.uniformMatrix4fv(dim1A.location, false, (Array.isArray(v554) || v554 instanceof Float32Array) ? v554 : (v555[0] = v554[0], v555[1] = v554[1], v555[2] = v554[2], v555[3] = v554[3], v555[4] = v554[4], v555[5] = v554[5], v555[6] = v554[6], v555[7] = v554[7], v555[8] = v554[8], v555[9] = v554[9], v555[10] = v554[10], v555[11] = v554[11], v555[12] = v554[12], v555[13] = v554[13], v555[14] = v554[14], v555[15] = v554[15], v555));
     v556 = v501['dim0B'];
     v8.uniformMatrix4fv(dim0B.location, false, (Array.isArray(v556) || v556 instanceof Float32Array) ? v556 : (v557[0] = v556[0], v557[1] = v556[1], v557[2] = v556[2], v557[3] = v556[3], v557[4] = v556[4], v557[5] = v556[5], v557[6] = v556[6], v557[7] = v556[7], v557[8] = v556[8], v557[9] = v556[9], v557[10] = v556[10], v557[11] = v556[11], v557[12] = v556[12], v557[13] = v556[13], v557[14] = v556[14], v557[15] = v556[15], v557));
     v558 = v501['dim1B'];
     v8.uniformMatrix4fv(dim1B.location, false, (Array.isArray(v558) || v558 instanceof Float32Array) ? v558 : (v559[0] = v558[0], v559[1] = v558[1], v559[2] = v558[2], v559[3] = v558[3], v559[4] = v558[4], v559[5] = v558[5], v559[6] = v558[6], v559[7] = v558[7], v559[8] = v558[8], v559[9] = v558[9], v559[10] = v558[10], v559[11] = v558[11], v559[12] = v558[12], v559[13] = v558[13], v559[14] = v558[14], v559[15] = v558[15], v559));
     v560 = v501['dim0C'];
     v8.uniformMatrix4fv(dim0C.location, false, (Array.isArray(v560) || v560 instanceof Float32Array) ? v560 : (v561[0] = v560[0], v561[1] = v560[1], v561[2] = v560[2], v561[3] = v560[3], v561[4] = v560[4], v561[5] = v560[5], v561[6] = v560[6], v561[7] = v560[7], v561[8] = v560[8], v561[9] = v560[9], v561[10] = v560[10], v561[11] = v560[11], v561[12] = v560[12], v561[13] = v560[13], v561[14] = v560[14], v561[15] = v560[15], v561));
     v562 = v501['dim1C'];
     v8.uniformMatrix4fv(dim1C.location, false, (Array.isArray(v562) || v562 instanceof Float32Array) ? v562 : (v563[0] = v562[0], v563[1] = v562[1], v563[2] = v562[2], v563[3] = v562[3], v563[4] = v562[4], v563[5] = v562[5], v563[6] = v562[6], v563[7] = v562[7], v563[8] = v562[8], v563[9] = v562[9], v563[10] = v562[10], v563[11] = v562[11], v563[12] = v562[12], v563[13] = v562[13], v563[14] = v562[14], v563[15] = v562[15], v563));
     v564 = v501['dim0D'];
     v8.uniformMatrix4fv(dim0D.location, false, (Array.isArray(v564) || v564 instanceof Float32Array) ? v564 : (v565[0] = v564[0], v565[1] = v564[1], v565[2] = v564[2], v565[3] = v564[3], v565[4] = v564[4], v565[5] = v564[5], v565[6] = v564[6], v565[7] = v564[7], v565[8] = v564[8], v565[9] = v564[9], v565[10] = v564[10], v565[11] = v564[11], v565[12] = v564[12], v565[13] = v564[13], v565[14] = v564[14], v565[15] = v564[15], v565));
     v566 = v501['dim1D'];
     v8.uniformMatrix4fv(dim1D.location, false, (Array.isArray(v566) || v566 instanceof Float32Array) ? v566 : (v567[0] = v566[0], v567[1] = v566[1], v567[2] = v566[2], v567[3] = v566[3], v567[4] = v566[4], v567[5] = v566[5], v567[6] = v566[6], v567[7] = v566[7], v567[8] = v566[8], v567[9] = v566[9], v567[10] = v566[10], v567[11] = v566[11], v567[12] = v566[12], v567[13] = v566[13], v567[14] = v566[14], v567[15] = v566[15], v567));
     v568 = v501['loA'];
     v8.uniformMatrix4fv(loA.location, false, (Array.isArray(v568) || v568 instanceof Float32Array) ? v568 : (v569[0] = v568[0], v569[1] = v568[1], v569[2] = v568[2], v569[3] = v568[3], v569[4] = v568[4], v569[5] = v568[5], v569[6] = v568[6], v569[7] = v568[7], v569[8] = v568[8], v569[9] = v568[9], v569[10] = v568[10], v569[11] = v568[11], v569[12] = v568[12], v569[13] = v568[13], v569[14] = v568[14], v569[15] = v568[15], v569));
     v570 = v501['hiA'];
     v8.uniformMatrix4fv(hiA.location, false, (Array.isArray(v570) || v570 instanceof Float32Array) ? v570 : (v571[0] = v570[0], v571[1] = v570[1], v571[2] = v570[2], v571[3] = v570[3], v571[4] = v570[4], v571[5] = v570[5], v571[6] = v570[6], v571[7] = v570[7], v571[8] = v570[8], v571[9] = v570[9], v571[10] = v570[10], v571[11] = v570[11], v571[12] = v570[12], v571[13] = v570[13], v571[14] = v570[14], v571[15] = v570[15], v571));
     v572 = v501['loB'];
     v8.uniformMatrix4fv(loB.location, false, (Array.isArray(v572) || v572 instanceof Float32Array) ? v572 : (v573[0] = v572[0], v573[1] = v572[1], v573[2] = v572[2], v573[3] = v572[3], v573[4] = v572[4], v573[5] = v572[5], v573[6] = v572[6], v573[7] = v572[7], v573[8] = v572[8], v573[9] = v572[9], v573[10] = v572[10], v573[11] = v572[11], v573[12] = v572[12], v573[13] = v572[13], v573[14] = v572[14], v573[15] = v572[15], v573));
     v574 = v501['hiB'];
     v8.uniformMatrix4fv(hiB.location, false, (Array.isArray(v574) || v574 instanceof Float32Array) ? v574 : (v575[0] = v574[0], v575[1] = v574[1], v575[2] = v574[2], v575[3] = v574[3], v575[4] = v574[4], v575[5] = v574[5], v575[6] = v574[6], v575[7] = v574[7], v575[8] = v574[8], v575[9] = v574[9], v575[10] = v574[10], v575[11] = v574[11], v575[12] = v574[12], v575[13] = v574[13], v575[14] = v574[14], v575[15] = v574[15], v575));
     v576 = v501['loC'];
     v8.uniformMatrix4fv(loC.location, false, (Array.isArray(v576) || v576 instanceof Float32Array) ? v576 : (v577[0] = v576[0], v577[1] = v576[1], v577[2] = v576[2], v577[3] = v576[3], v577[4] = v576[4], v577[5] = v576[5], v577[6] = v576[6], v577[7] = v576[7], v577[8] = v576[8], v577[9] = v576[9], v577[10] = v576[10], v577[11] = v576[11], v577[12] = v576[12], v577[13] = v576[13], v577[14] = v576[14], v577[15] = v576[15], v577));
     v578 = v501['hiC'];
     v8.uniformMatrix4fv(hiC.location, false, (Array.isArray(v578) || v578 instanceof Float32Array) ? v578 : (v579[0] = v578[0], v579[1] = v578[1], v579[2] = v578[2], v579[3] = v578[3], v579[4] = v578[4], v579[5] = v578[5], v579[6] = v578[6], v579[7] = v578[7], v579[8] = v578[8], v579[9] = v578[9], v579[10] = v578[10], v579[11] = v578[11], v579[12] = v578[12], v579[13] = v578[13], v579[14] = v578[14], v579[15] = v578[15], v579));
     v580 = v501['loD'];
     v8.uniformMatrix4fv(loD.location, false, (Array.isArray(v580) || v580 instanceof Float32Array) ? v580 : (v581[0] = v580[0], v581[1] = v580[1], v581[2] = v580[2], v581[3] = v580[3], v581[4] = v580[4], v581[5] = v580[5], v581[6] = v580[6], v581[7] = v580[7], v581[8] = v580[8], v581[9] = v580[9], v581[10] = v580[10], v581[11] = v580[11], v581[12] = v580[12], v581[13] = v580[13], v581[14] = v580[14], v581[15] = v580[15], v581));
     v582 = v501['hiD'];
     v8.uniformMatrix4fv(hiD.location, false, (Array.isArray(v582) || v582 instanceof Float32Array) ? v582 : (v583[0] = v582[0], v583[1] = v582[1], v583[2] = v582[2], v583[3] = v582[3], v583[4] = v582[4], v583[5] = v582[5], v583[6] = v582[6], v583[7] = v582[7], v583[8] = v582[8], v583[9] = v582[9], v583[10] = v582[10], v583[11] = v582[11], v583[12] = v582[12], v583[13] = v582[13], v583[14] = v582[14], v583[15] = v582[15], v583));
     v584 = v501['resolution'];
     v585 = v584[0];
     v587 = v584[1];
     if (!v500 || v586 !== v585 || v588 !== v587) {
      v586 = v585;
      v588 = v587;
      v8.uniform2f(resolution.location, v585, v587);
     }
     v589 = v501['viewBoxPos'];
     v590 = v589[0];
     v592 = v589[1];
     if (!v500 || v591 !== v590 || v593 !== v592) {
      v591 = v590;
      v593 = v592;
      v8.uniform2f(viewBoxPos.location, v590, v592);
     }
     v594 = v501['viewBoxSize'];
     v595 = v594[0];
     v597 = v594[1];
     if (!v500 || v596 !== v595 || v598 !== v597) {
      v596 = v595;
      v598 = v597;
      v8.uniform2f(viewBoxSize.location, v595, v597);
     }
     v599 = v501['maskHeight'];
     if (!v500 || v600 !== v599) {
      v600 = v599;
      v8.uniform1f(maskHeight.location, v599);
     }
     v601 = v501['drwLayer'];
     if (!v500 || v602 !== v601) {
      v602 = v601;
      v8.uniform1f(drwLayer.location, v601);
     }
     v603 = v501['contextColor'];
     v604 = v603[0];
     v606 = v603[1];
     v608 = v603[2];
     v610 = v603[3];
     if (!v500 || v605 !== v604 || v607 !== v606 || v609 !== v608 || v611 !== v610) {
      v605 = v604;
      v607 = v606;
      v609 = v608;
      v611 = v610;
      v8.uniform4f(contextColor.location, v604, v606, v608, v610);
     }
     v612 = v501['maskTexture'];
     if (v612 && v612._reglType === 'framebuffer') {
      v612 = v612.color[0];
     }
     v613 = v612._texture;
     v8.uniform1i(maskTexture.location, v613.bind());
     v615 = v501['offset'];
     v616 = v501['count'];
     if (v616) {
      if (v614) {
       v8.drawElements(1, v616, v614.type, v615 << ((v614.type - 5121) >> 1));
      }
      else {
       v8.drawArrays(1, v615, v616);
      }
      v2.viewportWidth = v510;
      v2.viewportHeight = v511;
      v613.unbind();
     }
    }
    $38.unbind();
    v3.dirty = true;
    v15.setVAO(null);
    v3.profile = v499;
   }
   , 'draw': function (a0) {
    var v49, v75, v76, v77, v78, v79, v80, v81, v82, v83, v84, v85, v86, v87, v88, v89, v90, v91, v92, v93, v94, v95, v96, v97, v98, v99, v100, v101, v102, v103, v104, v105, v106, v107, v108, v109, v110, v111, v112, v113, v114, v115, v116, v117, v118, v119, v120, v121, v122, v123, v124, v125, v126, v128, v130, v132, v134, v136, v138, v140, v142, v144, v146, v148, v150, v152, v154, v156, v158, v159, v160, v161, v162, v163, v164, v165, v166, v167, v168, v169, v170, v171, v172, v173, v174, v175, v176, v177, v178;
    v49 = v7.next;
    if (v49 !== v7.cur) {
     if (v49) {
      v8.bindFramebuffer(36160, v49.framebuffer);
     }
     else {
      v8.bindFramebuffer(36160, null);
     }
     v7.cur = v49;
    }
    if (v3.dirty) {
     var v50, v51, v52, v53, v54, v55, v56, v57, v58, v59, v60, v61, v62, v63, v64, v65, v66, v67, v68, v69, v70, v71, v72, v73, v74;
     v50 = v22[0];
     v51 = v22[1];
     v52 = v22[2];
     v53 = v22[3];
     if (v50 !== v23[0] || v51 !== v23[1] || v52 !== v23[2] || v53 !== v23[3]) {
      v8.colorMask(v50, v51, v52, v53);
      v23[0] = v50;
      v23[1] = v51;
      v23[2] = v52;
      v23[3] = v53;
     }
     v54 = v10.frontFace;
     if (v54 !== v3.frontFace) {
      v8.frontFace(v54);
      v3.frontFace = v54;
     }
     v55 = v10.polygonOffset_enable;
     if (v55 !== v3.polygonOffset_enable) {
      if (v55) {
       v8.enable(32823);
      }
      else {
       v8.disable(32823);
      }
      v3.polygonOffset_enable = v55;
     }
     v56 = v26[0];
     v57 = v26[1];
     if (v56 !== v27[0] || v57 !== v27[1]) {
      v8.polygonOffset(v56, v57);
      v27[0] = v56;
      v27[1] = v57;
     }
     v58 = v10.sample_alpha;
     if (v58 !== v3.sample_alpha) {
      if (v58) {
       v8.enable(32926);
      }
      else {
       v8.disable(32926);
      }
      v3.sample_alpha = v58;
     }
     v59 = v10.sample_enable;
     if (v59 !== v3.sample_enable) {
      if (v59) {
       v8.enable(32928);
      }
      else {
       v8.disable(32928);
      }
      v3.sample_enable = v59;
     }
     v60 = v28[0];
     v61 = v28[1];
     if (v60 !== v29[0] || v61 !== v29[1]) {
      v8.sampleCoverage(v60, v61);
      v29[0] = v60;
      v29[1] = v61;
     }
     v62 = v10.stencil_enable;
     if (v62 !== v3.stencil_enable) {
      if (v62) {
       v8.enable(2960);
      }
      else {
       v8.disable(2960);
      }
      v3.stencil_enable = v62;
     }
     v63 = v10.stencil_mask;
     if (v63 !== v3.stencil_mask) {
      v8.stencilMask(v63);
      v3.stencil_mask = v63;
     }
     v64 = v32[0];
     v65 = v32[1];
     v66 = v32[2];
     if (v64 !== v33[0] || v65 !== v33[1] || v66 !== v33[2]) {
      v8.stencilFunc(v64, v65, v66);
      v33[0] = v64;
      v33[1] = v65;
      v33[2] = v66;
     }
     v67 = v36[0];
     v68 = v36[1];
     v69 = v36[2];
     v70 = v36[3];
     if (v67 !== v37[0] || v68 !== v37[1] || v69 !== v37[2] || v70 !== v37[3]) {
      v8.stencilOpSeparate(v67, v68, v69, v70);
      v37[0] = v67;
      v37[1] = v68;
      v37[2] = v69;
      v37[3] = v70;
     }
     v71 = v34[0];
     v72 = v34[1];
     v73 = v34[2];
     v74 = v34[3];
     if (v71 !== v35[0] || v72 !== v35[1] || v73 !== v35[2] || v74 !== v35[3]) {
      v8.stencilOpSeparate(v71, v72, v73, v74);
      v35[0] = v71;
      v35[1] = v72;
      v35[2] = v73;
      v35[3] = v74;
     }
    }
    v75 = a0['viewportHeight'];
    v47.height = v75;
    v76 = a0['viewportWidth'];
    v47.width = v76;
    v77 = a0['viewportX'];
    v47.x = v77;
    v78 = a0['viewportY'];
    v47.y = v78;
    v79 = v47.x | 0;
    v80 = v47.y | 0;
    v81 = 'width' in v47 ? v47.width | 0 : (v2.framebufferWidth - v79);
    v82 = 'height' in v47 ? v47.height | 0 : (v2.framebufferHeight - v80);
    v83 = v2.viewportWidth;
    v2.viewportWidth = v81;
    v84 = v2.viewportHeight;
    v2.viewportHeight = v82;
    v8.viewport(v79, v80, v81, v82);
    v39[0] = v79;
    v39[1] = v80;
    v39[2] = v81;
    v39[3] = v82;
    v8.blendColor(0, 0, 0, 0);
    v17[0] = 0;
    v17[1] = 0;
    v17[2] = 0;
    v17[3] = 0;
    v8.disable(3042);
    v3.blend_enable = false;
    v8.blendEquationSeparate(32774, 32774);
    v19[0] = 32774;
    v19[1] = 32774;
    v8.blendFuncSeparate(770, 771, 1, 1);
    v21[0] = 770;
    v21[1] = 771;
    v21[2] = 1;
    v21[3] = 1;
    v8.enable(2884);
    v3.cull_enable = true;
    v8.cullFace(1029);
    v3.cull_face = 1029;
    v8.enable(2929);
    v3.depth_enable = true;
    v8.depthFunc(513);
    v3.depth_func = 513;
    v8.depthMask(true);
    v3.depth_mask = true;
    v8.depthRange(0, 1);
    v25[0] = 0;
    v25[1] = 1;
    v8.disable(3024);
    v3.dither = false;
    v8.lineWidth(2);
    v3.lineWidth = 2;
    v85 = a0['scissorHeight'];
    v48.height = v85;
    v86 = a0['scissorWidth'];
    v48.width = v86;
    v87 = a0['scissorX'];
    v48.x = v87;
    v88 = a0['scissorY'];
    v48.y = v88;
    v89 = v48.x | 0;
    v90 = v48.y | 0;
    v91 = 'width' in v48 ? v48.width | 0 : (v2.framebufferWidth - v89);
    v92 = 'height' in v48 ? v48.height | 0 : (v2.framebufferHeight - v90);
    v8.scissor(v89, v90, v91, v92);
    v31[0] = v89;
    v31[1] = v90;
    v31[2] = v91;
    v31[3] = v92;
    v8.enable(3089);
    v3.scissor_enable = true;
    v93 = v3.profile;
    v3.profile = false;
    v8.useProgram($2.program);
    v15.setVAO(null);
    v94 = p01_04.location;
    v95 = v0[v94];
    if (!v95.buffer) {
     v8.enableVertexAttribArray(v94);
    }
    if (v95.type !== $3.dtype || v95.size !== 4 || v95.buffer !== $3 || v95.normalized !== false || v95.offset !== 0 || v95.stride !== 0) {
     v8.bindBuffer(34962, $3.buffer);
     v8.vertexAttribPointer(v94, 4, $3.dtype, false, 0, 0);
     v95.type = $3.dtype;
     v95.size = 4;
     v95.buffer = $3;
     v95.normalized = false;
     v95.offset = 0;
     v95.stride = 0;
    }
    v96 = p05_08.location;
    v97 = v0[v96];
    if (!v97.buffer) {
     v8.enableVertexAttribArray(v96);
    }
    if (v97.type !== $4.dtype || v97.size !== 4 || v97.buffer !== $4 || v97.normalized !== false || v97.offset !== 0 || v97.stride !== 0) {
     v8.bindBuffer(34962, $4.buffer);
     v8.vertexAttribPointer(v96, 4, $4.dtype, false, 0, 0);
     v97.type = $4.dtype;
     v97.size = 4;
     v97.buffer = $4;
     v97.normalized = false;
     v97.offset = 0;
     v97.stride = 0;
    }
    v98 = p09_12.location;
    v99 = v0[v98];
    if (!v99.buffer) {
     v8.enableVertexAttribArray(v98);
    }
    if (v99.type !== $5.dtype || v99.size !== 4 || v99.buffer !== $5 || v99.normalized !== false || v99.offset !== 0 || v99.stride !== 0) {
     v8.bindBuffer(34962, $5.buffer);
     v8.vertexAttribPointer(v98, 4, $5.dtype, false, 0, 0);
     v99.type = $5.dtype;
     v99.size = 4;
     v99.buffer = $5;
     v99.normalized = false;
     v99.offset = 0;
     v99.stride = 0;
    }
    v100 = p13_16.location;
    v101 = v0[v100];
    if (!v101.buffer) {
     v8.enableVertexAttribArray(v100);
    }
    if (v101.type !== $6.dtype || v101.size !== 4 || v101.buffer !== $6 || v101.normalized !== false || v101.offset !== 0 || v101.stride !== 0) {
     v8.bindBuffer(34962, $6.buffer);
     v8.vertexAttribPointer(v100, 4, $6.dtype, false, 0, 0);
     v101.type = $6.dtype;
     v101.size = 4;
     v101.buffer = $6;
     v101.normalized = false;
     v101.offset = 0;
     v101.stride = 0;
    }
    v102 = p17_20.location;
    v103 = v0[v102];
    if (!v103.buffer) {
     v8.enableVertexAttribArray(v102);
    }
    if (v103.type !== $7.dtype || v103.size !== 4 || v103.buffer !== $7 || v103.normalized !== false || v103.offset !== 0 || v103.stride !== 0) {
     v8.bindBuffer(34962, $7.buffer);
     v8.vertexAttribPointer(v102, 4, $7.dtype, false, 0, 0);
     v103.type = $7.dtype;
     v103.size = 4;
     v103.buffer = $7;
     v103.normalized = false;
     v103.offset = 0;
     v103.stride = 0;
    }
    v104 = p21_24.location;
    v105 = v0[v104];
    if (!v105.buffer) {
     v8.enableVertexAttribArray(v104);
    }
    if (v105.type !== $8.dtype || v105.size !== 4 || v105.buffer !== $8 || v105.normalized !== false || v105.offset !== 0 || v105.stride !== 0) {
     v8.bindBuffer(34962, $8.buffer);
     v8.vertexAttribPointer(v104, 4, $8.dtype, false, 0, 0);
     v105.type = $8.dtype;
     v105.size = 4;
     v105.buffer = $8;
     v105.normalized = false;
     v105.offset = 0;
     v105.stride = 0;
    }
    v106 = p25_28.location;
    v107 = v0[v106];
    if (!v107.buffer) {
     v8.enableVertexAttribArray(v106);
    }
    if (v107.type !== $9.dtype || v107.size !== 4 || v107.buffer !== $9 || v107.normalized !== false || v107.offset !== 0 || v107.stride !== 0) {
     v8.bindBuffer(34962, $9.buffer);
     v8.vertexAttribPointer(v106, 4, $9.dtype, false, 0, 0);
     v107.type = $9.dtype;
     v107.size = 4;
     v107.buffer = $9;
     v107.normalized = false;
     v107.offset = 0;
     v107.stride = 0;
    }
    v108 = p29_32.location;
    v109 = v0[v108];
    if (!v109.buffer) {
     v8.enableVertexAttribArray(v108);
    }
    if (v109.type !== $10.dtype || v109.size !== 4 || v109.buffer !== $10 || v109.normalized !== false || v109.offset !== 0 || v109.stride !== 0) {
     v8.bindBuffer(34962, $10.buffer);
     v8.vertexAttribPointer(v108, 4, $10.dtype, false, 0, 0);
     v109.type = $10.dtype;
     v109.size = 4;
     v109.buffer = $10;
     v109.normalized = false;
     v109.offset = 0;
     v109.stride = 0;
    }
    v110 = p33_36.location;
    v111 = v0[v110];
    if (!v111.buffer) {
     v8.enableVertexAttribArray(v110);
    }
    if (v111.type !== $11.dtype || v111.size !== 4 || v111.buffer !== $11 || v111.normalized !== false || v111.offset !== 0 || v111.stride !== 0) {
     v8.bindBuffer(34962, $11.buffer);
     v8.vertexAttribPointer(v110, 4, $11.dtype, false, 0, 0);
     v111.type = $11.dtype;
     v111.size = 4;
     v111.buffer = $11;
     v111.normalized = false;
     v111.offset = 0;
     v111.stride = 0;
    }
    v112 = p37_40.location;
    v113 = v0[v112];
    if (!v113.buffer) {
     v8.enableVertexAttribArray(v112);
    }
    if (v113.type !== $12.dtype || v113.size !== 4 || v113.buffer !== $12 || v113.normalized !== false || v113.offset !== 0 || v113.stride !== 0) {
     v8.bindBuffer(34962, $12.buffer);
     v8.vertexAttribPointer(v112, 4, $12.dtype, false, 0, 0);
     v113.type = $12.dtype;
     v113.size = 4;
     v113.buffer = $12;
     v113.normalized = false;
     v113.offset = 0;
     v113.stride = 0;
    }
    v114 = p41_44.location;
    v115 = v0[v114];
    if (!v115.buffer) {
     v8.enableVertexAttribArray(v114);
    }
    if (v115.type !== $13.dtype || v115.size !== 4 || v115.buffer !== $13 || v115.normalized !== false || v115.offset !== 0 || v115.stride !== 0) {
     v8.bindBuffer(34962, $13.buffer);
     v8.vertexAttribPointer(v114, 4, $13.dtype, false, 0, 0);
     v115.type = $13.dtype;
     v115.size = 4;
     v115.buffer = $13;
     v115.normalized = false;
     v115.offset = 0;
     v115.stride = 0;
    }
    v116 = p45_48.location;
    v117 = v0[v116];
    if (!v117.buffer) {
     v8.enableVertexAttribArray(v116);
    }
    if (v117.type !== $14.dtype || v117.size !== 4 || v117.buffer !== $14 || v117.normalized !== false || v117.offset !== 0 || v117.stride !== 0) {
     v8.bindBuffer(34962, $14.buffer);
     v8.vertexAttribPointer(v116, 4, $14.dtype, false, 0, 0);
     v117.type = $14.dtype;
     v117.size = 4;
     v117.buffer = $14;
     v117.normalized = false;
     v117.offset = 0;
     v117.stride = 0;
    }
    v118 = p49_52.location;
    v119 = v0[v118];
    if (!v119.buffer) {
     v8.enableVertexAttribArray(v118);
    }
    if (v119.type !== $15.dtype || v119.size !== 4 || v119.buffer !== $15 || v119.normalized !== false || v119.offset !== 0 || v119.stride !== 0) {
     v8.bindBuffer(34962, $15.buffer);
     v8.vertexAttribPointer(v118, 4, $15.dtype, false, 0, 0);
     v119.type = $15.dtype;
     v119.size = 4;
     v119.buffer = $15;
     v119.normalized = false;
     v119.offset = 0;
     v119.stride = 0;
    }
    v120 = p53_56.location;
    v121 = v0[v120];
    if (!v121.buffer) {
     v8.enableVertexAttribArray(v120);
    }
    if (v121.type !== $16.dtype || v121.size !== 4 || v121.buffer !== $16 || v121.normalized !== false || v121.offset !== 0 || v121.stride !== 0) {
     v8.bindBuffer(34962, $16.buffer);
     v8.vertexAttribPointer(v120, 4, $16.dtype, false, 0, 0);
     v121.type = $16.dtype;
     v121.size = 4;
     v121.buffer = $16;
     v121.normalized = false;
     v121.offset = 0;
     v121.stride = 0;
    }
    v122 = p57_60.location;
    v123 = v0[v122];
    if (!v123.buffer) {
     v8.enableVertexAttribArray(v122);
    }
    if (v123.type !== $17.dtype || v123.size !== 4 || v123.buffer !== $17 || v123.normalized !== false || v123.offset !== 0 || v123.stride !== 0) {
     v8.bindBuffer(34962, $17.buffer);
     v8.vertexAttribPointer(v122, 4, $17.dtype, false, 0, 0);
     v123.type = $17.dtype;
     v123.size = 4;
     v123.buffer = $17;
     v123.normalized = false;
     v123.offset = 0;
     v123.stride = 0;
    }
    v124 = colors.location;
    v125 = v0[v124];
    if (!v125.buffer) {
     v8.enableVertexAttribArray(v124);
    }
    if (v125.type !== $18.dtype || v125.size !== 4 || v125.buffer !== $18 || v125.normalized !== false || v125.offset !== 0 || v125.stride !== 0) {
     v8.bindBuffer(34962, $18.buffer);
     v8.vertexAttribPointer(v124, 4, $18.dtype, false, 0, 0);
     v125.type = $18.dtype;
     v125.size = 4;
     v125.buffer = $18;
     v125.normalized = false;
     v125.offset = 0;
     v125.stride = 0;
    }
    v126 = a0['dim0A'];
    v8.uniformMatrix4fv(dim0A.location, false, (Array.isArray(v126) || v126 instanceof Float32Array) ? v126 : (v127[0] = v126[0], v127[1] = v126[1], v127[2] = v126[2], v127[3] = v126[3], v127[4] = v126[4], v127[5] = v126[5], v127[6] = v126[6], v127[7] = v126[7], v127[8] = v126[8], v127[9] = v126[9], v127[10] = v126[10], v127[11] = v126[11], v127[12] = v126[12], v127[13] = v126[13], v127[14] = v126[14], v127[15] = v126[15], v127));
    v128 = a0['dim1A'];
    v8.uniformMatrix4fv(dim1A.location, false, (Array.isArray(v128) || v128 instanceof Float32Array) ? v128 : (v129[0] = v128[0], v129[1] = v128[1], v129[2] = v128[2], v129[3] = v128[3], v129[4] = v128[4], v129[5] = v128[5], v129[6] = v128[6], v129[7] = v128[7], v129[8] = v128[8], v129[9] = v128[9], v129[10] = v128[10], v129[11] = v128[11], v129[12] = v128[12], v129[13] = v128[13], v129[14] = v128[14], v129[15] = v128[15], v129));
    v130 = a0['dim0B'];
    v8.uniformMatrix4fv(dim0B.location, false, (Array.isArray(v130) || v130 instanceof Float32Array) ? v130 : (v131[0] = v130[0], v131[1] = v130[1], v131[2] = v130[2], v131[3] = v130[3], v131[4] = v130[4], v131[5] = v130[5], v131[6] = v130[6], v131[7] = v130[7], v131[8] = v130[8], v131[9] = v130[9], v131[10] = v130[10], v131[11] = v130[11], v131[12] = v130[12], v131[13] = v130[13], v131[14] = v130[14], v131[15] = v130[15], v131));
    v132 = a0['dim1B'];
    v8.uniformMatrix4fv(dim1B.location, false, (Array.isArray(v132) || v132 instanceof Float32Array) ? v132 : (v133[0] = v132[0], v133[1] = v132[1], v133[2] = v132[2], v133[3] = v132[3], v133[4] = v132[4], v133[5] = v132[5], v133[6] = v132[6], v133[7] = v132[7], v133[8] = v132[8], v133[9] = v132[9], v133[10] = v132[10], v133[11] = v132[11], v133[12] = v132[12], v133[13] = v132[13], v133[14] = v132[14], v133[15] = v132[15], v133));
    v134 = a0['dim0C'];
    v8.uniformMatrix4fv(dim0C.location, false, (Array.isArray(v134) || v134 instanceof Float32Array) ? v134 : (v135[0] = v134[0], v135[1] = v134[1], v135[2] = v134[2], v135[3] = v134[3], v135[4] = v134[4], v135[5] = v134[5], v135[6] = v134[6], v135[7] = v134[7], v135[8] = v134[8], v135[9] = v134[9], v135[10] = v134[10], v135[11] = v134[11], v135[12] = v134[12], v135[13] = v134[13], v135[14] = v134[14], v135[15] = v134[15], v135));
    v136 = a0['dim1C'];
    v8.uniformMatrix4fv(dim1C.location, false, (Array.isArray(v136) || v136 instanceof Float32Array) ? v136 : (v137[0] = v136[0], v137[1] = v136[1], v137[2] = v136[2], v137[3] = v136[3], v137[4] = v136[4], v137[5] = v136[5], v137[6] = v136[6], v137[7] = v136[7], v137[8] = v136[8], v137[9] = v136[9], v137[10] = v136[10], v137[11] = v136[11], v137[12] = v136[12], v137[13] = v136[13], v137[14] = v136[14], v137[15] = v136[15], v137));
    v138 = a0['dim0D'];
    v8.uniformMatrix4fv(dim0D.location, false, (Array.isArray(v138) || v138 instanceof Float32Array) ? v138 : (v139[0] = v138[0], v139[1] = v138[1], v139[2] = v138[2], v139[3] = v138[3], v139[4] = v138[4], v139[5] = v138[5], v139[6] = v138[6], v139[7] = v138[7], v139[8] = v138[8], v139[9] = v138[9], v139[10] = v138[10], v139[11] = v138[11], v139[12] = v138[12], v139[13] = v138[13], v139[14] = v138[14], v139[15] = v138[15], v139));
    v140 = a0['dim1D'];
    v8.uniformMatrix4fv(dim1D.location, false, (Array.isArray(v140) || v140 instanceof Float32Array) ? v140 : (v141[0] = v140[0], v141[1] = v140[1], v141[2] = v140[2], v141[3] = v140[3], v141[4] = v140[4], v141[5] = v140[5], v141[6] = v140[6], v141[7] = v140[7], v141[8] = v140[8], v141[9] = v140[9], v141[10] = v140[10], v141[11] = v140[11], v141[12] = v140[12], v141[13] = v140[13], v141[14] = v140[14], v141[15] = v140[15], v141));
    v142 = a0['loA'];
    v8.uniformMatrix4fv(loA.location, false, (Array.isArray(v142) || v142 instanceof Float32Array) ? v142 : (v143[0] = v142[0], v143[1] = v142[1], v143[2] = v142[2], v143[3] = v142[3], v143[4] = v142[4], v143[5] = v142[5], v143[6] = v142[6], v143[7] = v142[7], v143[8] = v142[8], v143[9] = v142[9], v143[10] = v142[10], v143[11] = v142[11], v143[12] = v142[12], v143[13] = v142[13], v143[14] = v142[14], v143[15] = v142[15], v143));
    v144 = a0['hiA'];
    v8.uniformMatrix4fv(hiA.location, false, (Array.isArray(v144) || v144 instanceof Float32Array) ? v144 : (v145[0] = v144[0], v145[1] = v144[1], v145[2] = v144[2], v145[3] = v144[3], v145[4] = v144[4], v145[5] = v144[5], v145[6] = v144[6], v145[7] = v144[7], v145[8] = v144[8], v145[9] = v144[9], v145[10] = v144[10], v145[11] = v144[11], v145[12] = v144[12], v145[13] = v144[13], v145[14] = v144[14], v145[15] = v144[15], v145));
    v146 = a0['loB'];
    v8.uniformMatrix4fv(loB.location, false, (Array.isArray(v146) || v146 instanceof Float32Array) ? v146 : (v147[0] = v146[0], v147[1] = v146[1], v147[2] = v146[2], v147[3] = v146[3], v147[4] = v146[4], v147[5] = v146[5], v147[6] = v146[6], v147[7] = v146[7], v147[8] = v146[8], v147[9] = v146[9], v147[10] = v146[10], v147[11] = v146[11], v147[12] = v146[12], v147[13] = v146[13], v147[14] = v146[14], v147[15] = v146[15], v147));
    v148 = a0['hiB'];
    v8.uniformMatrix4fv(hiB.location, false, (Array.isArray(v148) || v148 instanceof Float32Array) ? v148 : (v149[0] = v148[0], v149[1] = v148[1], v149[2] = v148[2], v149[3] = v148[3], v149[4] = v148[4], v149[5] = v148[5], v149[6] = v148[6], v149[7] = v148[7], v149[8] = v148[8], v149[9] = v148[9], v149[10] = v148[10], v149[11] = v148[11], v149[12] = v148[12], v149[13] = v148[13], v149[14] = v148[14], v149[15] = v148[15], v149));
    v150 = a0['loC'];
    v8.uniformMatrix4fv(loC.location, false, (Array.isArray(v150) || v150 instanceof Float32Array) ? v150 : (v151[0] = v150[0], v151[1] = v150[1], v151[2] = v150[2], v151[3] = v150[3], v151[4] = v150[4], v151[5] = v150[5], v151[6] = v150[6], v151[7] = v150[7], v151[8] = v150[8], v151[9] = v150[9], v151[10] = v150[10], v151[11] = v150[11], v151[12] = v150[12], v151[13] = v150[13], v151[14] = v150[14], v151[15] = v150[15], v151));
    v152 = a0['hiC'];
    v8.uniformMatrix4fv(hiC.location, false, (Array.isArray(v152) || v152 instanceof Float32Array) ? v152 : (v153[0] = v152[0], v153[1] = v152[1], v153[2] = v152[2], v153[3] = v152[3], v153[4] = v152[4], v153[5] = v152[5], v153[6] = v152[6], v153[7] = v152[7], v153[8] = v152[8], v153[9] = v152[9], v153[10] = v152[10], v153[11] = v152[11], v153[12] = v152[12], v153[13] = v152[13], v153[14] = v152[14], v153[15] = v152[15], v153));
    v154 = a0['loD'];
    v8.uniformMatrix4fv(loD.location, false, (Array.isArray(v154) || v154 instanceof Float32Array) ? v154 : (v155[0] = v154[0], v155[1] = v154[1], v155[2] = v154[2], v155[3] = v154[3], v155[4] = v154[4], v155[5] = v154[5], v155[6] = v154[6], v155[7] = v154[7], v155[8] = v154[8], v155[9] = v154[9], v155[10] = v154[10], v155[11] = v154[11], v155[12] = v154[12], v155[13] = v154[13], v155[14] = v154[14], v155[15] = v154[15], v155));
    v156 = a0['hiD'];
    v8.uniformMatrix4fv(hiD.location, false, (Array.isArray(v156) || v156 instanceof Float32Array) ? v156 : (v157[0] = v156[0], v157[1] = v156[1], v157[2] = v156[2], v157[3] = v156[3], v157[4] = v156[4], v157[5] = v156[5], v157[6] = v156[6], v157[7] = v156[7], v157[8] = v156[8], v157[9] = v156[9], v157[10] = v156[10], v157[11] = v156[11], v157[12] = v156[12], v157[13] = v156[13], v157[14] = v156[14], v157[15] = v156[15], v157));
    v158 = a0['resolution'];
    v159 = v158[0];
    v160 = v158[1];
    v8.uniform2f(resolution.location, v159, v160);
    v161 = a0['viewBoxPos'];
    v162 = v161[0];
    v163 = v161[1];
    v8.uniform2f(viewBoxPos.location, v162, v163);
    v164 = a0['viewBoxSize'];
    v165 = v164[0];
    v166 = v164[1];
    v8.uniform2f(viewBoxSize.location, v165, v166);
    v167 = a0['maskHeight'];
    v8.uniform1f(maskHeight.location, v167);
    v168 = a0['drwLayer'];
    v8.uniform1f(drwLayer.location, v168);
    v169 = a0['contextColor'];
    v170 = v169[0];
    v171 = v169[1];
    v172 = v169[2];
    v173 = v169[3];
    v8.uniform4f(contextColor.location, v170, v171, v172, v173);
    v174 = a0['maskTexture'];
    if (v174 && v174._reglType === 'framebuffer') {
     v174 = v174.color[0];
    }
    v175 = v174._texture;
    v8.uniform1i(maskTexture.location, v175.bind());
    v8.uniform1i(palette.location, $19.bind());
    v176 = v4.elements;
    if (v176) {
     v8.bindBuffer(34963, v176.buffer.buffer);
    }
    else if (v15.currentVAO) {
     v176 = v5.getElements(v15.currentVAO.elements);
     if (v176) v8.bindBuffer(34963, v176.buffer.buffer);
    }
    v177 = a0['offset'];
    v178 = a0['count'];
    if (v178) {
     if (v176) {
      v8.drawElements(1, v178, v176.type, v177 << ((v176.type - 5121) >> 1));
     }
     else {
      v8.drawArrays(1, v177, v178);
     }
     v3.dirty = true;
     v15.setVAO(null);
     v2.viewportWidth = v83;
     v2.viewportHeight = v84;
     v3.profile = v93;
     v175.unbind();
     $19.unbind();
    }
   }
   , 'scope': function (a0, a1, a2) {
    var v179, v180, v181, v182, v183, v184, v185, v186, v187, v188, v189, v190, v191, v192, v193, v194, v195, v196, v197, v198, v199, v200, v201, v202, v203, v204, v205, v206, v207, v208, v209, v210, v211, v212, v213, v214, v215, v216, v217, v218, v219, v220, v221, v222, v223, v224, v225, v226, v227, v228, v229, v230, v231, v232, v233, v234, v235, v236, v237, v238, v239, v240, v241, v242, v243, v244, v245, v246, v247, v248, v249, v250, v251, v252, v253, v254, v255, v256, v257, v258, v259, v260, v261, v262, v263, v264, v265, v266, v267, v268, v269, v270, v271, v272, v273, v274, v275, v276, v277, v278, v279, v280, v281, v282, v283, v284, v285, v286, v287, v288, v289, v290, v291, v292, v293, v294, v295, v296, v297, v298, v299, v300, v301, v302, v303, v304, v305, v306, v307, v308, v309, v310, v311, v312, v313, v314, v315, v316, v317, v318, v319, v320, v321, v322, v323, v324, v325, v326, v327, v328, v329, v330, v331, v332, v333, v334, v335, v336, v337, v338, v339, v340, v341, v342, v343, v344, v345, v346, v347, v348, v349, v350, v351, v352, v353, v354, v355, v356, v357, v358, v359, v360, v361, v362, v363, v364, v365, v366, v367, v368, v369, v370, v371, v372, v373, v374, v375, v376, v377, v378, v379, v380, v381, v382, v383, v384, v385, v386, v387, v388, v389, v390, v391, v392, v393, v394, v395, v396, v397, v398, v399, v400, v401, v402, v403, v404, v405, v406, v407, v408, v409, v410, v411, v412, v413, v414, v415, v416, v417, v418, v419, v420, v421, v422, v423, v424, v425, v426, v427, v428, v429, v430, v431, v432, v433, v434, v435, v436, v437, v438, v439, v440, v441, v442, v443, v444, v445, v446, v447, v448, v449, v450, v451, v452, v453, v454, v455, v456, v457, v458, v459, v460, v461, v462, v463, v464, v465, v466, v467, v468, v469, v470, v471, v472;
    v179 = a0['viewportHeight'];
    v47.height = v179;
    v180 = a0['viewportWidth'];
    v47.width = v180;
    v181 = a0['viewportX'];
    v47.x = v181;
    v182 = a0['viewportY'];
    v47.y = v182;
    v183 = v47.x | 0;
    v184 = v47.y | 0;
    v185 = 'width' in v47 ? v47.width | 0 : (v2.framebufferWidth - v183);
    v186 = 'height' in v47 ? v47.height | 0 : (v2.framebufferHeight - v184);
    v187 = v2.viewportWidth;
    v2.viewportWidth = v185;
    v188 = v2.viewportHeight;
    v2.viewportHeight = v186;
    v189 = v38[0];
    v38[0] = v183;
    v190 = v38[1];
    v38[1] = v184;
    v191 = v38[2];
    v38[2] = v185;
    v192 = v38[3];
    v38[3] = v186;
    v193 = v16[0];
    v16[0] = 0;
    v194 = v16[1];
    v16[1] = 0;
    v195 = v16[2];
    v16[2] = 0;
    v196 = v16[3];
    v16[3] = 0;
    v197 = v10.blend_enable;
    v10.blend_enable = false;
    v198 = v18[0];
    v18[0] = 32774;
    v199 = v18[1];
    v18[1] = 32774;
    v200 = v20[0];
    v20[0] = 770;
    v201 = v20[1];
    v20[1] = 771;
    v202 = v20[2];
    v20[2] = 1;
    v203 = v20[3];
    v20[3] = 1;
    v204 = v10.cull_enable;
    v10.cull_enable = true;
    v205 = v10.cull_face;
    v10.cull_face = 1029;
    v206 = v10.depth_enable;
    v10.depth_enable = true;
    v207 = v10.depth_func;
    v10.depth_func = 513;
    v208 = v10.depth_mask;
    v10.depth_mask = true;
    v209 = v24[0];
    v24[0] = 0;
    v210 = v24[1];
    v24[1] = 1;
    v211 = v10.dither;
    v10.dither = false;
    v212 = v10.lineWidth;
    v10.lineWidth = 2;
    v213 = a0['scissorHeight'];
    v48.height = v213;
    v214 = a0['scissorWidth'];
    v48.width = v214;
    v215 = a0['scissorX'];
    v48.x = v215;
    v216 = a0['scissorY'];
    v48.y = v216;
    v217 = v48.x | 0;
    v218 = v48.y | 0;
    v219 = 'width' in v48 ? v48.width | 0 : (v2.framebufferWidth - v217);
    v220 = 'height' in v48 ? v48.height | 0 : (v2.framebufferHeight - v218);
    v221 = v30[0];
    v30[0] = v217;
    v222 = v30[1];
    v30[1] = v218;
    v223 = v30[2];
    v30[2] = v219;
    v224 = v30[3];
    v30[3] = v220;
    v225 = v10.scissor_enable;
    v10.scissor_enable = true;
    v226 = v3.profile;
    v3.profile = false;
    v227 = a0['offset'];
    v228 = v4.offset;
    v4.offset = v227;
    v229 = a0['count'];
    v230 = v4.count;
    v4.count = v229;
    v231 = v4.primitive;
    v4.primitive = 1;
    v232 = a0['contextColor'];
    v233 = v14[24];
    v14[24] = v232;
    v234 = a0['dim0A'];
    v235 = v14[3];
    v14[3] = v234;
    v236 = a0['dim0B'];
    v237 = v14[5];
    v14[5] = v236;
    v238 = a0['dim0C'];
    v239 = v14[7];
    v14[7] = v238;
    v240 = a0['dim0D'];
    v241 = v14[9];
    v14[9] = v240;
    v242 = a0['dim1A'];
    v243 = v14[4];
    v14[4] = v242;
    v244 = a0['dim1B'];
    v245 = v14[6];
    v14[6] = v244;
    v246 = a0['dim1C'];
    v247 = v14[8];
    v14[8] = v246;
    v248 = a0['dim1D'];
    v249 = v14[10];
    v14[10] = v248;
    v250 = a0['drwLayer'];
    v251 = v14[23];
    v14[23] = v250;
    v252 = a0['hiA'];
    v253 = v14[12];
    v14[12] = v252;
    v254 = a0['hiB'];
    v255 = v14[14];
    v14[14] = v254;
    v256 = a0['hiC'];
    v257 = v14[16];
    v14[16] = v256;
    v258 = a0['hiD'];
    v259 = v14[18];
    v14[18] = v258;
    v260 = a0['loA'];
    v261 = v14[11];
    v14[11] = v260;
    v262 = a0['loB'];
    v263 = v14[13];
    v14[13] = v262;
    v264 = a0['loC'];
    v265 = v14[15];
    v14[15] = v264;
    v266 = a0['loD'];
    v267 = v14[17];
    v14[17] = v266;
    v268 = a0['maskHeight'];
    v269 = v14[22];
    v14[22] = v268;
    v270 = a0['maskTexture'];
    v271 = v14[25];
    v14[25] = v270;
    v272 = v14[26];
    v14[26] = $20;
    v273 = a0['resolution'];
    v274 = v14[19];
    v14[19] = v273;
    v275 = a0['viewBoxPos'];
    v276 = v14[20];
    v14[20] = v275;
    v277 = a0['viewBoxSize'];
    v278 = v14[21];
    v14[21] = v277;
    v279 = $21.buffer;
    $21.buffer = $18;
    v280 = $21.divisor;
    $21.divisor = 0;
    v281 = $21.normalized;
    $21.normalized = false;
    v282 = $21.offset;
    $21.offset = 0;
    v283 = $21.size;
    $21.size = 0;
    v284 = $21.state;
    $21.state = 1;
    v285 = $21.stride;
    $21.stride = 0;
    v286 = $21.type;
    $21.type = $18.dtype;
    v287 = $21.w;
    $21.w = 0;
    v288 = $21.x;
    $21.x = 0;
    v289 = $21.y;
    $21.y = 0;
    v290 = $21.z;
    $21.z = 0;
    v291 = $22.buffer;
    $22.buffer = $3;
    v292 = $22.divisor;
    $22.divisor = 0;
    v293 = $22.normalized;
    $22.normalized = false;
    v294 = $22.offset;
    $22.offset = 0;
    v295 = $22.size;
    $22.size = 0;
    v296 = $22.state;
    $22.state = 1;
    v297 = $22.stride;
    $22.stride = 0;
    v298 = $22.type;
    $22.type = $3.dtype;
    v299 = $22.w;
    $22.w = 0;
    v300 = $22.x;
    $22.x = 0;
    v301 = $22.y;
    $22.y = 0;
    v302 = $22.z;
    $22.z = 0;
    v303 = $23.buffer;
    $23.buffer = $4;
    v304 = $23.divisor;
    $23.divisor = 0;
    v305 = $23.normalized;
    $23.normalized = false;
    v306 = $23.offset;
    $23.offset = 0;
    v307 = $23.size;
    $23.size = 0;
    v308 = $23.state;
    $23.state = 1;
    v309 = $23.stride;
    $23.stride = 0;
    v310 = $23.type;
    $23.type = $4.dtype;
    v311 = $23.w;
    $23.w = 0;
    v312 = $23.x;
    $23.x = 0;
    v313 = $23.y;
    $23.y = 0;
    v314 = $23.z;
    $23.z = 0;
    v315 = $24.buffer;
    $24.buffer = $5;
    v316 = $24.divisor;
    $24.divisor = 0;
    v317 = $24.normalized;
    $24.normalized = false;
    v318 = $24.offset;
    $24.offset = 0;
    v319 = $24.size;
    $24.size = 0;
    v320 = $24.state;
    $24.state = 1;
    v321 = $24.stride;
    $24.stride = 0;
    v322 = $24.type;
    $24.type = $5.dtype;
    v323 = $24.w;
    $24.w = 0;
    v324 = $24.x;
    $24.x = 0;
    v325 = $24.y;
    $24.y = 0;
    v326 = $24.z;
    $24.z = 0;
    v327 = $25.buffer;
    $25.buffer = $6;
    v328 = $25.divisor;
    $25.divisor = 0;
    v329 = $25.normalized;
    $25.normalized = false;
    v330 = $25.offset;
    $25.offset = 0;
    v331 = $25.size;
    $25.size = 0;
    v332 = $25.state;
    $25.state = 1;
    v333 = $25.stride;
    $25.stride = 0;
    v334 = $25.type;
    $25.type = $6.dtype;
    v335 = $25.w;
    $25.w = 0;
    v336 = $25.x;
    $25.x = 0;
    v337 = $25.y;
    $25.y = 0;
    v338 = $25.z;
    $25.z = 0;
    v339 = $26.buffer;
    $26.buffer = $7;
    v340 = $26.divisor;
    $26.divisor = 0;
    v341 = $26.normalized;
    $26.normalized = false;
    v342 = $26.offset;
    $26.offset = 0;
    v343 = $26.size;
    $26.size = 0;
    v344 = $26.state;
    $26.state = 1;
    v345 = $26.stride;
    $26.stride = 0;
    v346 = $26.type;
    $26.type = $7.dtype;
    v347 = $26.w;
    $26.w = 0;
    v348 = $26.x;
    $26.x = 0;
    v349 = $26.y;
    $26.y = 0;
    v350 = $26.z;
    $26.z = 0;
    v351 = $27.buffer;
    $27.buffer = $8;
    v352 = $27.divisor;
    $27.divisor = 0;
    v353 = $27.normalized;
    $27.normalized = false;
    v354 = $27.offset;
    $27.offset = 0;
    v355 = $27.size;
    $27.size = 0;
    v356 = $27.state;
    $27.state = 1;
    v357 = $27.stride;
    $27.stride = 0;
    v358 = $27.type;
    $27.type = $8.dtype;
    v359 = $27.w;
    $27.w = 0;
    v360 = $27.x;
    $27.x = 0;
    v361 = $27.y;
    $27.y = 0;
    v362 = $27.z;
    $27.z = 0;
    v363 = $28.buffer;
    $28.buffer = $9;
    v364 = $28.divisor;
    $28.divisor = 0;
    v365 = $28.normalized;
    $28.normalized = false;
    v366 = $28.offset;
    $28.offset = 0;
    v367 = $28.size;
    $28.size = 0;
    v368 = $28.state;
    $28.state = 1;
    v369 = $28.stride;
    $28.stride = 0;
    v370 = $28.type;
    $28.type = $9.dtype;
    v371 = $28.w;
    $28.w = 0;
    v372 = $28.x;
    $28.x = 0;
    v373 = $28.y;
    $28.y = 0;
    v374 = $28.z;
    $28.z = 0;
    v375 = $29.buffer;
    $29.buffer = $10;
    v376 = $29.divisor;
    $29.divisor = 0;
    v377 = $29.normalized;
    $29.normalized = false;
    v378 = $29.offset;
    $29.offset = 0;
    v379 = $29.size;
    $29.size = 0;
    v380 = $29.state;
    $29.state = 1;
    v381 = $29.stride;
    $29.stride = 0;
    v382 = $29.type;
    $29.type = $10.dtype;
    v383 = $29.w;
    $29.w = 0;
    v384 = $29.x;
    $29.x = 0;
    v385 = $29.y;
    $29.y = 0;
    v386 = $29.z;
    $29.z = 0;
    v387 = $30.buffer;
    $30.buffer = $11;
    v388 = $30.divisor;
    $30.divisor = 0;
    v389 = $30.normalized;
    $30.normalized = false;
    v390 = $30.offset;
    $30.offset = 0;
    v391 = $30.size;
    $30.size = 0;
    v392 = $30.state;
    $30.state = 1;
    v393 = $30.stride;
    $30.stride = 0;
    v394 = $30.type;
    $30.type = $11.dtype;
    v395 = $30.w;
    $30.w = 0;
    v396 = $30.x;
    $30.x = 0;
    v397 = $30.y;
    $30.y = 0;
    v398 = $30.z;
    $30.z = 0;
    v399 = $31.buffer;
    $31.buffer = $12;
    v400 = $31.divisor;
    $31.divisor = 0;
    v401 = $31.normalized;
    $31.normalized = false;
    v402 = $31.offset;
    $31.offset = 0;
    v403 = $31.size;
    $31.size = 0;
    v404 = $31.state;
    $31.state = 1;
    v405 = $31.stride;
    $31.stride = 0;
    v406 = $31.type;
    $31.type = $12.dtype;
    v407 = $31.w;
    $31.w = 0;
    v408 = $31.x;
    $31.x = 0;
    v409 = $31.y;
    $31.y = 0;
    v410 = $31.z;
    $31.z = 0;
    v411 = $32.buffer;
    $32.buffer = $13;
    v412 = $32.divisor;
    $32.divisor = 0;
    v413 = $32.normalized;
    $32.normalized = false;
    v414 = $32.offset;
    $32.offset = 0;
    v415 = $32.size;
    $32.size = 0;
    v416 = $32.state;
    $32.state = 1;
    v417 = $32.stride;
    $32.stride = 0;
    v418 = $32.type;
    $32.type = $13.dtype;
    v419 = $32.w;
    $32.w = 0;
    v420 = $32.x;
    $32.x = 0;
    v421 = $32.y;
    $32.y = 0;
    v422 = $32.z;
    $32.z = 0;
    v423 = $33.buffer;
    $33.buffer = $14;
    v424 = $33.divisor;
    $33.divisor = 0;
    v425 = $33.normalized;
    $33.normalized = false;
    v426 = $33.offset;
    $33.offset = 0;
    v427 = $33.size;
    $33.size = 0;
    v428 = $33.state;
    $33.state = 1;
    v429 = $33.stride;
    $33.stride = 0;
    v430 = $33.type;
    $33.type = $14.dtype;
    v431 = $33.w;
    $33.w = 0;
    v432 = $33.x;
    $33.x = 0;
    v433 = $33.y;
    $33.y = 0;
    v434 = $33.z;
    $33.z = 0;
    v435 = $34.buffer;
    $34.buffer = $15;
    v436 = $34.divisor;
    $34.divisor = 0;
    v437 = $34.normalized;
    $34.normalized = false;
    v438 = $34.offset;
    $34.offset = 0;
    v439 = $34.size;
    $34.size = 0;
    v440 = $34.state;
    $34.state = 1;
    v441 = $34.stride;
    $34.stride = 0;
    v442 = $34.type;
    $34.type = $15.dtype;
    v443 = $34.w;
    $34.w = 0;
    v444 = $34.x;
    $34.x = 0;
    v445 = $34.y;
    $34.y = 0;
    v446 = $34.z;
    $34.z = 0;
    v447 = $35.buffer;
    $35.buffer = $16;
    v448 = $35.divisor;
    $35.divisor = 0;
    v449 = $35.normalized;
    $35.normalized = false;
    v450 = $35.offset;
    $35.offset = 0;
    v451 = $35.size;
    $35.size = 0;
    v452 = $35.state;
    $35.state = 1;
    v453 = $35.stride;
    $35.stride = 0;
    v454 = $35.type;
    $35.type = $16.dtype;
    v455 = $35.w;
    $35.w = 0;
    v456 = $35.x;
    $35.x = 0;
    v457 = $35.y;
    $35.y = 0;
    v458 = $35.z;
    $35.z = 0;
    v459 = $36.buffer;
    $36.buffer = $17;
    v460 = $36.divisor;
    $36.divisor = 0;
    v461 = $36.normalized;
    $36.normalized = false;
    v462 = $36.offset;
    $36.offset = 0;
    v463 = $36.size;
    $36.size = 0;
    v464 = $36.state;
    $36.state = 1;
    v465 = $36.stride;
    $36.stride = 0;
    v466 = $36.type;
    $36.type = $17.dtype;
    v467 = $36.w;
    $36.w = 0;
    v468 = $36.x;
    $36.x = 0;
    v469 = $36.y;
    $36.y = 0;
    v470 = $36.z;
    $36.z = 0;
    v471 = v11.vert;
    v11.vert = 2;
    v472 = v11.frag;
    v11.frag = 1;
    v3.dirty = true;
    a1(v2, a0, a2);
    v2.viewportWidth = v187;
    v2.viewportHeight = v188;
    v38[0] = v189;
    v38[1] = v190;
    v38[2] = v191;
    v38[3] = v192;
    v16[0] = v193;
    v16[1] = v194;
    v16[2] = v195;
    v16[3] = v196;
    v10.blend_enable = v197;
    v18[0] = v198;
    v18[1] = v199;
    v20[0] = v200;
    v20[1] = v201;
    v20[2] = v202;
    v20[3] = v203;
    v10.cull_enable = v204;
    v10.cull_face = v205;
    v10.depth_enable = v206;
    v10.depth_func = v207;
    v10.depth_mask = v208;
    v24[0] = v209;
    v24[1] = v210;
    v10.dither = v211;
    v10.lineWidth = v212;
    v30[0] = v221;
    v30[1] = v222;
    v30[2] = v223;
    v30[3] = v224;
    v10.scissor_enable = v225;
    v3.profile = v226;
    v4.offset = v228;
    v4.count = v230;
    v4.primitive = v231;
    v14[24] = v233;
    v14[3] = v235;
    v14[5] = v237;
    v14[7] = v239;
    v14[9] = v241;
    v14[4] = v243;
    v14[6] = v245;
    v14[8] = v247;
    v14[10] = v249;
    v14[23] = v251;
    v14[12] = v253;
    v14[14] = v255;
    v14[16] = v257;
    v14[18] = v259;
    v14[11] = v261;
    v14[13] = v263;
    v14[15] = v265;
    v14[17] = v267;
    v14[22] = v269;
    v14[25] = v271;
    v14[26] = v272;
    v14[19] = v274;
    v14[20] = v276;
    v14[21] = v278;
    $21.buffer = v279;
    $21.divisor = v280;
    $21.normalized = v281;
    $21.offset = v282;
    $21.size = v283;
    $21.state = v284;
    $21.stride = v285;
    $21.type = v286;
    $21.w = v287;
    $21.x = v288;
    $21.y = v289;
    $21.z = v290;
    $22.buffer = v291;
    $22.divisor = v292;
    $22.normalized = v293;
    $22.offset = v294;
    $22.size = v295;
    $22.state = v296;
    $22.stride = v297;
    $22.type = v298;
    $22.w = v299;
    $22.x = v300;
    $22.y = v301;
    $22.z = v302;
    $23.buffer = v303;
    $23.divisor = v304;
    $23.normalized = v305;
    $23.offset = v306;
    $23.size = v307;
    $23.state = v308;
    $23.stride = v309;
    $23.type = v310;
    $23.w = v311;
    $23.x = v312;
    $23.y = v313;
    $23.z = v314;
    $24.buffer = v315;
    $24.divisor = v316;
    $24.normalized = v317;
    $24.offset = v318;
    $24.size = v319;
    $24.state = v320;
    $24.stride = v321;
    $24.type = v322;
    $24.w = v323;
    $24.x = v324;
    $24.y = v325;
    $24.z = v326;
    $25.buffer = v327;
    $25.divisor = v328;
    $25.normalized = v329;
    $25.offset = v330;
    $25.size = v331;
    $25.state = v332;
    $25.stride = v333;
    $25.type = v334;
    $25.w = v335;
    $25.x = v336;
    $25.y = v337;
    $25.z = v338;
    $26.buffer = v339;
    $26.divisor = v340;
    $26.normalized = v341;
    $26.offset = v342;
    $26.size = v343;
    $26.state = v344;
    $26.stride = v345;
    $26.type = v346;
    $26.w = v347;
    $26.x = v348;
    $26.y = v349;
    $26.z = v350;
    $27.buffer = v351;
    $27.divisor = v352;
    $27.normalized = v353;
    $27.offset = v354;
    $27.size = v355;
    $27.state = v356;
    $27.stride = v357;
    $27.type = v358;
    $27.w = v359;
    $27.x = v360;
    $27.y = v361;
    $27.z = v362;
    $28.buffer = v363;
    $28.divisor = v364;
    $28.normalized = v365;
    $28.offset = v366;
    $28.size = v367;
    $28.state = v368;
    $28.stride = v369;
    $28.type = v370;
    $28.w = v371;
    $28.x = v372;
    $28.y = v373;
    $28.z = v374;
    $29.buffer = v375;
    $29.divisor = v376;
    $29.normalized = v377;
    $29.offset = v378;
    $29.size = v379;
    $29.state = v380;
    $29.stride = v381;
    $29.type = v382;
    $29.w = v383;
    $29.x = v384;
    $29.y = v385;
    $29.z = v386;
    $30.buffer = v387;
    $30.divisor = v388;
    $30.normalized = v389;
    $30.offset = v390;
    $30.size = v391;
    $30.state = v392;
    $30.stride = v393;
    $30.type = v394;
    $30.w = v395;
    $30.x = v396;
    $30.y = v397;
    $30.z = v398;
    $31.buffer = v399;
    $31.divisor = v400;
    $31.normalized = v401;
    $31.offset = v402;
    $31.size = v403;
    $31.state = v404;
    $31.stride = v405;
    $31.type = v406;
    $31.w = v407;
    $31.x = v408;
    $31.y = v409;
    $31.z = v410;
    $32.buffer = v411;
    $32.divisor = v412;
    $32.normalized = v413;
    $32.offset = v414;
    $32.size = v415;
    $32.state = v416;
    $32.stride = v417;
    $32.type = v418;
    $32.w = v419;
    $32.x = v420;
    $32.y = v421;
    $32.z = v422;
    $33.buffer = v423;
    $33.divisor = v424;
    $33.normalized = v425;
    $33.offset = v426;
    $33.size = v427;
    $33.state = v428;
    $33.stride = v429;
    $33.type = v430;
    $33.w = v431;
    $33.x = v432;
    $33.y = v433;
    $33.z = v434;
    $34.buffer = v435;
    $34.divisor = v436;
    $34.normalized = v437;
    $34.offset = v438;
    $34.size = v439;
    $34.state = v440;
    $34.stride = v441;
    $34.type = v442;
    $34.w = v443;
    $34.x = v444;
    $34.y = v445;
    $34.z = v446;
    $35.buffer = v447;
    $35.divisor = v448;
    $35.normalized = v449;
    $35.offset = v450;
    $35.size = v451;
    $35.state = v452;
    $35.stride = v453;
    $35.type = v454;
    $35.w = v455;
    $35.x = v456;
    $35.y = v457;
    $35.z = v458;
    $36.buffer = v459;
    $36.divisor = v460;
    $36.normalized = v461;
    $36.offset = v462;
    $36.size = v463;
    $36.state = v464;
    $36.stride = v465;
    $36.type = v466;
    $36.w = v467;
    $36.x = v468;
    $36.y = v469;
    $36.z = v470;
    v11.vert = v471;
    v11.frag = v472;
    v3.dirty = true;
   }
   ,
  }

 },
 '$1': function ($0, $1
 ) {
  'use strict';
  var v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15, v16, v17, v18, v19, v20, v21, v22, v23, v24, v25, v26, v27, v28, v29, v30, v31, v32, v33, v34, v35, v36, v37, v38, v39, v40, v41, v42, v43, v44, v45, v46, v74, v75, v76, v77, v78, v79, v80, v81, v88, v89, v94, v95, v96, v97, v98, v99, v100, v101, v104, v105, v106, v107, v108, v109;
  v0 = $0.attributes;
  v1 = $0.buffer;
  v2 = $0.context;
  v3 = $0.current;
  v4 = $0.draw;
  v5 = $0.elements;
  v6 = $0.extensions;
  v7 = $0.framebuffer;
  v8 = $0.gl;
  v9 = $0.isBufferArgs;
  v10 = $0.next;
  v11 = $0.shader;
  v12 = $0.strings;
  v13 = $0.timer;
  v14 = $0.uniforms;
  v15 = $0.vao;
  v16 = v10.blend_color;
  v17 = v3.blend_color;
  v18 = v10.blend_equation;
  v19 = v3.blend_equation;
  v20 = v10.blend_func;
  v21 = v3.blend_func;
  v22 = v10.colorMask;
  v23 = v3.colorMask;
  v24 = v10.depth_range;
  v25 = v3.depth_range;
  v26 = v10.polygonOffset_offset;
  v27 = v3.polygonOffset_offset;
  v28 = v10.sample_coverage;
  v29 = v3.sample_coverage;
  v30 = v10.scissor_box;
  v31 = v3.scissor_box;
  v32 = v10.stencil_func;
  v33 = v3.stencil_func;
  v34 = v10.stencil_opBack;
  v35 = v3.stencil_opBack;
  v36 = v10.stencil_opFront;
  v37 = v3.stencil_opFront;
  v38 = v10.viewport;
  v39 = v3.viewport;
  v40 = {
   'add': 32774, 'subtract': 32778, 'reverse subtract': 32779
  }
   ;
  v41 = {
   '0': 0, '1': 1, 'zero': 0, 'one': 1, 'src color': 768, 'one minus src color': 769, 'src alpha': 770, 'one minus src alpha': 771, 'dst color': 774, 'one minus dst color': 775, 'dst alpha': 772, 'one minus dst alpha': 773, 'constant color': 32769, 'one minus constant color': 32770, 'constant alpha': 32771, 'one minus constant alpha': 32772, 'src alpha saturate': 776
  }
   ;
  v42 = {
   'never': 512, 'less': 513, '<': 513, 'equal': 514, '=': 514, '==': 514, '===': 514, 'lequal': 515, '<=': 515, 'greater': 516, '>': 516, 'notequal': 517, '!=': 517, '!==': 517, 'gequal': 518, '>=': 518, 'always': 519
  }
   ;
  v43 = {
   'int8': 5120, 'int16': 5122, 'int32': 5124, 'uint8': 5121, 'uint16': 5123, 'uint32': 5125, 'float': 5126, 'float32': 5126
  }
   ;
  v44 = {
   'cw': 2304, 'ccw': 2305
  }
   ;
  v45 = {
   'points': 0, 'point': 0, 'lines': 1, 'line': 1, 'triangles': 4, 'triangle': 4, 'line loop': 2, 'line strip': 3, 'triangle strip': 5, 'triangle fan': 6
  }
   ;
  v46 = {
   '0': 0, 'zero': 0, 'keep': 7680, 'replace': 7681, 'increment': 7682, 'decrement': 7683, 'increment wrap': 34055, 'decrement wrap': 34056, 'invert': 5386
  }
   ;
  v74 = v10.blend_color;
  v75 = v3.blend_color;
  v76 = v10.blend_equation;
  v77 = v3.blend_equation;
  v78 = v10.blend_func;
  v79 = v3.blend_func;
  v80 = v10.colorMask;
  v81 = v3.colorMask;
  v88 = v10.depth_range;
  v89 = v3.depth_range;
  v94 = v10.polygonOffset_offset;
  v95 = v3.polygonOffset_offset;
  v96 = v10.sample_coverage;
  v97 = v3.sample_coverage;
  v98 = v10.scissor_box;
  v99 = v3.scissor_box;
  v100 = v10.stencil_func;
  v101 = v3.stencil_func;
  v104 = v10.stencil_opBack;
  v105 = v3.stencil_opBack;
  v106 = v10.stencil_opFront;
  v107 = v3.stencil_opFront;
  v108 = v10.viewport;
  v109 = v3.viewport;
  return {
   'poll': function () {
    var v47;
    var v65, v66, v67, v68, v69, v70, v71, v72, v73, v82, v83, v84, v85, v86, v87, v90, v91, v92, v93, v102, v103;
    v3.dirty = false;
    v65 = v10.blend_enable;
    v66 = v10.cull_enable;
    v67 = v10.depth_enable;
    v68 = v10.dither;
    v69 = v10.polygonOffset_enable;
    v70 = v10.sample_alpha;
    v71 = v10.sample_enable;
    v72 = v10.scissor_enable;
    v73 = v10.stencil_enable;
    v82 = v10.cull_face;
    v83 = v3.cull_face;
    v84 = v10.depth_func;
    v85 = v3.depth_func;
    v86 = v10.depth_mask;
    v87 = v3.depth_mask;
    v90 = v10.frontFace;
    v91 = v3.frontFace;
    v92 = v10.lineWidth;
    v93 = v3.lineWidth;
    v102 = v10.stencil_mask;
    v103 = v3.stencil_mask;
    v47 = v7.next;
    if (v47 !== v7.cur) {
     if (v47) {
      v8.bindFramebuffer(36160, v47.framebuffer);
     }
     else {
      v8.bindFramebuffer(36160, null);
     }
     v7.cur = v47;
    }
    if (v65 !== v3.blend_enable) {
     if (v65) {
      v8.enable(3042)
     }
     else {
      v8.disable(3042)
     }
     v3.blend_enable = v65;
    }
    if (v66 !== v3.cull_enable) {
     if (v66) {
      v8.enable(2884)
     }
     else {
      v8.disable(2884)
     }
     v3.cull_enable = v66;
    }
    if (v67 !== v3.depth_enable) {
     if (v67) {
      v8.enable(2929)
     }
     else {
      v8.disable(2929)
     }
     v3.depth_enable = v67;
    }
    if (v68 !== v3.dither) {
     if (v68) {
      v8.enable(3024)
     }
     else {
      v8.disable(3024)
     }
     v3.dither = v68;
    }
    if (v69 !== v3.polygonOffset_enable) {
     if (v69) {
      v8.enable(32823)
     }
     else {
      v8.disable(32823)
     }
     v3.polygonOffset_enable = v69;
    }
    if (v70 !== v3.sample_alpha) {
     if (v70) {
      v8.enable(32926)
     }
     else {
      v8.disable(32926)
     }
     v3.sample_alpha = v70;
    }
    if (v71 !== v3.sample_enable) {
     if (v71) {
      v8.enable(32928)
     }
     else {
      v8.disable(32928)
     }
     v3.sample_enable = v71;
    }
    if (v72 !== v3.scissor_enable) {
     if (v72) {
      v8.enable(3089)
     }
     else {
      v8.disable(3089)
     }
     v3.scissor_enable = v72;
    }
    if (v73 !== v3.stencil_enable) {
     if (v73) {
      v8.enable(2960)
     }
     else {
      v8.disable(2960)
     }
     v3.stencil_enable = v73;
    }
    if (v74[0] !== v75[0] || v74[1] !== v75[1] || v74[2] !== v75[2] || v74[3] !== v75[3]) {
     v8.blendColor(v74[0], v74[1], v74[2], v74[3]);
     v75[0] = v74[0];
     v75[1] = v74[1];
     v75[2] = v74[2];
     v75[3] = v74[3];
    }
    if (v76[0] !== v77[0] || v76[1] !== v77[1]) {
     v8.blendEquationSeparate(v76[0], v76[1]);
     v77[0] = v76[0];
     v77[1] = v76[1];
    }
    if (v78[0] !== v79[0] || v78[1] !== v79[1] || v78[2] !== v79[2] || v78[3] !== v79[3]) {
     v8.blendFuncSeparate(v78[0], v78[1], v78[2], v78[3]);
     v79[0] = v78[0];
     v79[1] = v78[1];
     v79[2] = v78[2];
     v79[3] = v78[3];
    }
    if (v80[0] !== v81[0] || v80[1] !== v81[1] || v80[2] !== v81[2] || v80[3] !== v81[3]) {
     v8.colorMask(v80[0], v80[1], v80[2], v80[3]);
     v81[0] = v80[0];
     v81[1] = v80[1];
     v81[2] = v80[2];
     v81[3] = v80[3];
    }
    if (v82 !== v83) {
     v8.cullFace(v82);
     v3.cull_face = v82;
    }
    if (v84 !== v85) {
     v8.depthFunc(v84);
     v3.depth_func = v84;
    }
    if (v86 !== v87) {
     v8.depthMask(v86);
     v3.depth_mask = v86;
    }
    if (v88[0] !== v89[0] || v88[1] !== v89[1]) {
     v8.depthRange(v88[0], v88[1]);
     v89[0] = v88[0];
     v89[1] = v88[1];
    }
    if (v90 !== v91) {
     v8.frontFace(v90);
     v3.frontFace = v90;
    }
    if (v92 !== v93) {
     v8.lineWidth(v92);
     v3.lineWidth = v92;
    }
    if (v94[0] !== v95[0] || v94[1] !== v95[1]) {
     v8.polygonOffset(v94[0], v94[1]);
     v95[0] = v94[0];
     v95[1] = v94[1];
    }
    if (v96[0] !== v97[0] || v96[1] !== v97[1]) {
     v8.sampleCoverage(v96[0], v96[1]);
     v97[0] = v96[0];
     v97[1] = v96[1];
    }
    if (v98[0] !== v99[0] || v98[1] !== v99[1] || v98[2] !== v99[2] || v98[3] !== v99[3]) {
     v8.scissor(v98[0], v98[1], v98[2], v98[3]);
     v99[0] = v98[0];
     v99[1] = v98[1];
     v99[2] = v98[2];
     v99[3] = v98[3];
    }
    if (v100[0] !== v101[0] || v100[1] !== v101[1] || v100[2] !== v101[2]) {
     v8.stencilFunc(v100[0], v100[1], v100[2]);
     v101[0] = v100[0];
     v101[1] = v100[1];
     v101[2] = v100[2];
    }
    if (v102 !== v103) {
     v8.stencilMask(v102);
     v3.stencil_mask = v102;
    }
    if (v104[0] !== v105[0] || v104[1] !== v105[1] || v104[2] !== v105[2] || v104[3] !== v105[3]) {
     v8.stencilOpSeparate(v104[0], v104[1], v104[2], v104[3]);
     v105[0] = v104[0];
     v105[1] = v104[1];
     v105[2] = v104[2];
     v105[3] = v104[3];
    }
    if (v106[0] !== v107[0] || v106[1] !== v107[1] || v106[2] !== v107[2] || v106[3] !== v107[3]) {
     v8.stencilOpSeparate(v106[0], v106[1], v106[2], v106[3]);
     v107[0] = v106[0];
     v107[1] = v106[1];
     v107[2] = v106[2];
     v107[3] = v106[3];
    }
    if (v108[0] !== v109[0] || v108[1] !== v109[1] || v108[2] !== v109[2] || v108[3] !== v109[3]) {
     v8.viewport(v108[0], v108[1], v108[2], v108[3]);
     v109[0] = v108[0];
     v109[1] = v108[1];
     v109[2] = v108[2];
     v109[3] = v108[3];
    }
   }
   , 'refresh': function () {
    var v48, v49, v50, v51, v52, v53, v54, v55, v56, v57, v58, v59, v60, v61, v62, v63, v64;
    var v65, v66, v67, v68, v69, v70, v71, v72, v73, v82, v83, v84, v85, v86, v87, v90, v91, v92, v93, v102, v103;
    v3.dirty = false;
    v65 = v10.blend_enable;
    v66 = v10.cull_enable;
    v67 = v10.depth_enable;
    v68 = v10.dither;
    v69 = v10.polygonOffset_enable;
    v70 = v10.sample_alpha;
    v71 = v10.sample_enable;
    v72 = v10.scissor_enable;
    v73 = v10.stencil_enable;
    v82 = v10.cull_face;
    v83 = v3.cull_face;
    v84 = v10.depth_func;
    v85 = v3.depth_func;
    v86 = v10.depth_mask;
    v87 = v3.depth_mask;
    v90 = v10.frontFace;
    v91 = v3.frontFace;
    v92 = v10.lineWidth;
    v93 = v3.lineWidth;
    v102 = v10.stencil_mask;
    v103 = v3.stencil_mask;
    v48 = v7.next;
    if (v48) {
     v8.bindFramebuffer(36160, v48.framebuffer);
    }
    else {
     v8.bindFramebuffer(36160, null);
    }
    v7.cur = v48;
    v49 = v0[0];
    if (v49.buffer) {
     v8.enableVertexAttribArray(0);
     v8.bindBuffer(34962, v49.buffer.buffer);
     v8.vertexAttribPointer(0, v49.size, v49.type, v49.normalized, v49.stride, v49.offset);
    }
    else {
     v8.disableVertexAttribArray(0);
     v8.vertexAttrib4f(0, v49.x, v49.y, v49.z, v49.w);
     v49.buffer = null;
    }
    $1.vertexAttribDivisorANGLE(0, v49.divisor);
    v50 = v0[1];
    if (v50.buffer) {
     v8.enableVertexAttribArray(1);
     v8.bindBuffer(34962, v50.buffer.buffer);
     v8.vertexAttribPointer(1, v50.size, v50.type, v50.normalized, v50.stride, v50.offset);
    }
    else {
     v8.disableVertexAttribArray(1);
     v8.vertexAttrib4f(1, v50.x, v50.y, v50.z, v50.w);
     v50.buffer = null;
    }
    $1.vertexAttribDivisorANGLE(1, v50.divisor);
    v51 = v0[2];
    if (v51.buffer) {
     v8.enableVertexAttribArray(2);
     v8.bindBuffer(34962, v51.buffer.buffer);
     v8.vertexAttribPointer(2, v51.size, v51.type, v51.normalized, v51.stride, v51.offset);
    }
    else {
     v8.disableVertexAttribArray(2);
     v8.vertexAttrib4f(2, v51.x, v51.y, v51.z, v51.w);
     v51.buffer = null;
    }
    $1.vertexAttribDivisorANGLE(2, v51.divisor);
    v52 = v0[3];
    if (v52.buffer) {
     v8.enableVertexAttribArray(3);
     v8.bindBuffer(34962, v52.buffer.buffer);
     v8.vertexAttribPointer(3, v52.size, v52.type, v52.normalized, v52.stride, v52.offset);
    }
    else {
     v8.disableVertexAttribArray(3);
     v8.vertexAttrib4f(3, v52.x, v52.y, v52.z, v52.w);
     v52.buffer = null;
    }
    $1.vertexAttribDivisorANGLE(3, v52.divisor);
    v53 = v0[4];
    if (v53.buffer) {
     v8.enableVertexAttribArray(4);
     v8.bindBuffer(34962, v53.buffer.buffer);
     v8.vertexAttribPointer(4, v53.size, v53.type, v53.normalized, v53.stride, v53.offset);
    }
    else {
     v8.disableVertexAttribArray(4);
     v8.vertexAttrib4f(4, v53.x, v53.y, v53.z, v53.w);
     v53.buffer = null;
    }
    $1.vertexAttribDivisorANGLE(4, v53.divisor);
    v54 = v0[5];
    if (v54.buffer) {
     v8.enableVertexAttribArray(5);
     v8.bindBuffer(34962, v54.buffer.buffer);
     v8.vertexAttribPointer(5, v54.size, v54.type, v54.normalized, v54.stride, v54.offset);
    }
    else {
     v8.disableVertexAttribArray(5);
     v8.vertexAttrib4f(5, v54.x, v54.y, v54.z, v54.w);
     v54.buffer = null;
    }
    $1.vertexAttribDivisorANGLE(5, v54.divisor);
    v55 = v0[6];
    if (v55.buffer) {
     v8.enableVertexAttribArray(6);
     v8.bindBuffer(34962, v55.buffer.buffer);
     v8.vertexAttribPointer(6, v55.size, v55.type, v55.normalized, v55.stride, v55.offset);
    }
    else {
     v8.disableVertexAttribArray(6);
     v8.vertexAttrib4f(6, v55.x, v55.y, v55.z, v55.w);
     v55.buffer = null;
    }
    $1.vertexAttribDivisorANGLE(6, v55.divisor);
    v56 = v0[7];
    if (v56.buffer) {
     v8.enableVertexAttribArray(7);
     v8.bindBuffer(34962, v56.buffer.buffer);
     v8.vertexAttribPointer(7, v56.size, v56.type, v56.normalized, v56.stride, v56.offset);
    }
    else {
     v8.disableVertexAttribArray(7);
     v8.vertexAttrib4f(7, v56.x, v56.y, v56.z, v56.w);
     v56.buffer = null;
    }
    $1.vertexAttribDivisorANGLE(7, v56.divisor);
    v57 = v0[8];
    if (v57.buffer) {
     v8.enableVertexAttribArray(8);
     v8.bindBuffer(34962, v57.buffer.buffer);
     v8.vertexAttribPointer(8, v57.size, v57.type, v57.normalized, v57.stride, v57.offset);
    }
    else {
     v8.disableVertexAttribArray(8);
     v8.vertexAttrib4f(8, v57.x, v57.y, v57.z, v57.w);
     v57.buffer = null;
    }
    $1.vertexAttribDivisorANGLE(8, v57.divisor);
    v58 = v0[9];
    if (v58.buffer) {
     v8.enableVertexAttribArray(9);
     v8.bindBuffer(34962, v58.buffer.buffer);
     v8.vertexAttribPointer(9, v58.size, v58.type, v58.normalized, v58.stride, v58.offset);
    }
    else {
     v8.disableVertexAttribArray(9);
     v8.vertexAttrib4f(9, v58.x, v58.y, v58.z, v58.w);
     v58.buffer = null;
    }
    $1.vertexAttribDivisorANGLE(9, v58.divisor);
    v59 = v0[10];
    if (v59.buffer) {
     v8.enableVertexAttribArray(10);
     v8.bindBuffer(34962, v59.buffer.buffer);
     v8.vertexAttribPointer(10, v59.size, v59.type, v59.normalized, v59.stride, v59.offset);
    }
    else {
     v8.disableVertexAttribArray(10);
     v8.vertexAttrib4f(10, v59.x, v59.y, v59.z, v59.w);
     v59.buffer = null;
    }
    $1.vertexAttribDivisorANGLE(10, v59.divisor);
    v60 = v0[11];
    if (v60.buffer) {
     v8.enableVertexAttribArray(11);
     v8.bindBuffer(34962, v60.buffer.buffer);
     v8.vertexAttribPointer(11, v60.size, v60.type, v60.normalized, v60.stride, v60.offset);
    }
    else {
     v8.disableVertexAttribArray(11);
     v8.vertexAttrib4f(11, v60.x, v60.y, v60.z, v60.w);
     v60.buffer = null;
    }
    $1.vertexAttribDivisorANGLE(11, v60.divisor);
    v61 = v0[12];
    if (v61.buffer) {
     v8.enableVertexAttribArray(12);
     v8.bindBuffer(34962, v61.buffer.buffer);
     v8.vertexAttribPointer(12, v61.size, v61.type, v61.normalized, v61.stride, v61.offset);
    }
    else {
     v8.disableVertexAttribArray(12);
     v8.vertexAttrib4f(12, v61.x, v61.y, v61.z, v61.w);
     v61.buffer = null;
    }
    $1.vertexAttribDivisorANGLE(12, v61.divisor);
    v62 = v0[13];
    if (v62.buffer) {
     v8.enableVertexAttribArray(13);
     v8.bindBuffer(34962, v62.buffer.buffer);
     v8.vertexAttribPointer(13, v62.size, v62.type, v62.normalized, v62.stride, v62.offset);
    }
    else {
     v8.disableVertexAttribArray(13);
     v8.vertexAttrib4f(13, v62.x, v62.y, v62.z, v62.w);
     v62.buffer = null;
    }
    $1.vertexAttribDivisorANGLE(13, v62.divisor);
    v63 = v0[14];
    if (v63.buffer) {
     v8.enableVertexAttribArray(14);
     v8.bindBuffer(34962, v63.buffer.buffer);
     v8.vertexAttribPointer(14, v63.size, v63.type, v63.normalized, v63.stride, v63.offset);
    }
    else {
     v8.disableVertexAttribArray(14);
     v8.vertexAttrib4f(14, v63.x, v63.y, v63.z, v63.w);
     v63.buffer = null;
    }
    $1.vertexAttribDivisorANGLE(14, v63.divisor);
    v64 = v0[15];
    if (v64.buffer) {
     v8.enableVertexAttribArray(15);
     v8.bindBuffer(34962, v64.buffer.buffer);
     v8.vertexAttribPointer(15, v64.size, v64.type, v64.normalized, v64.stride, v64.offset);
    }
    else {
     v8.disableVertexAttribArray(15);
     v8.vertexAttrib4f(15, v64.x, v64.y, v64.z, v64.w);
     v64.buffer = null;
    }
    $1.vertexAttribDivisorANGLE(15, v64.divisor);
    v15.currentVAO = null;
    v15.setVAO(v15.targetVAO);
    if (v65) {
     v8.enable(3042)
    }
    else {
     v8.disable(3042)
    }
    v3.blend_enable = v65;
    if (v66) {
     v8.enable(2884)
    }
    else {
     v8.disable(2884)
    }
    v3.cull_enable = v66;
    if (v67) {
     v8.enable(2929)
    }
    else {
     v8.disable(2929)
    }
    v3.depth_enable = v67;
    if (v68) {
     v8.enable(3024)
    }
    else {
     v8.disable(3024)
    }
    v3.dither = v68;
    if (v69) {
     v8.enable(32823)
    }
    else {
     v8.disable(32823)
    }
    v3.polygonOffset_enable = v69;
    if (v70) {
     v8.enable(32926)
    }
    else {
     v8.disable(32926)
    }
    v3.sample_alpha = v70;
    if (v71) {
     v8.enable(32928)
    }
    else {
     v8.disable(32928)
    }
    v3.sample_enable = v71;
    if (v72) {
     v8.enable(3089)
    }
    else {
     v8.disable(3089)
    }
    v3.scissor_enable = v72;
    if (v73) {
     v8.enable(2960)
    }
    else {
     v8.disable(2960)
    }
    v3.stencil_enable = v73;
    v8.blendColor(v74[0], v74[1], v74[2], v74[3]);
    v75[0] = v74[0];
    v75[1] = v74[1];
    v75[2] = v74[2];
    v75[3] = v74[3];
    v8.blendEquationSeparate(v76[0], v76[1]);
    v77[0] = v76[0];
    v77[1] = v76[1];
    v8.blendFuncSeparate(v78[0], v78[1], v78[2], v78[3]);
    v79[0] = v78[0];
    v79[1] = v78[1];
    v79[2] = v78[2];
    v79[3] = v78[3];
    v8.colorMask(v80[0], v80[1], v80[2], v80[3]);
    v81[0] = v80[0];
    v81[1] = v80[1];
    v81[2] = v80[2];
    v81[3] = v80[3];
    v8.cullFace(v82);
    v3.cull_face = v82;
    v8.depthFunc(v84);
    v3.depth_func = v84;
    v8.depthMask(v86);
    v3.depth_mask = v86;
    v8.depthRange(v88[0], v88[1]);
    v89[0] = v88[0];
    v89[1] = v88[1];
    v8.frontFace(v90);
    v3.frontFace = v90;
    v8.lineWidth(v92);
    v3.lineWidth = v92;
    v8.polygonOffset(v94[0], v94[1]);
    v95[0] = v94[0];
    v95[1] = v94[1];
    v8.sampleCoverage(v96[0], v96[1]);
    v97[0] = v96[0];
    v97[1] = v96[1];
    v8.scissor(v98[0], v98[1], v98[2], v98[3]);
    v99[0] = v98[0];
    v99[1] = v98[1];
    v99[2] = v98[2];
    v99[3] = v98[3];
    v8.stencilFunc(v100[0], v100[1], v100[2]);
    v101[0] = v100[0];
    v101[1] = v100[1];
    v101[2] = v100[2];
    v8.stencilMask(v102);
    v3.stencil_mask = v102;
    v8.stencilOpSeparate(v104[0], v104[1], v104[2], v104[3]);
    v105[0] = v104[0];
    v105[1] = v104[1];
    v105[2] = v104[2];
    v105[3] = v104[3];
    v8.stencilOpSeparate(v106[0], v106[1], v106[2], v106[3]);
    v107[0] = v106[0];
    v107[1] = v106[1];
    v107[2] = v106[2];
    v107[3] = v106[3];
    v8.viewport(v108[0], v108[1], v108[2], v108[3]);
    v109[0] = v108[0];
    v109[1] = v108[1];
    v109[2] = v108[2];
    v109[3] = v108[3];
   }
   ,
  }

 },
 '$32,capOffset,capSize,color,direction,error,lineOffset,lineWidth,opacity,position,positionFract,scale,scaleFract,translate,translateFract,viewport': function ($0, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, capOffset, capSize, color, direction, error, lineOffset, lineWidth, opacity, position, positionFract, scale, scaleFract, translate, translateFract, viewport
 ) {
  'use strict';
  var v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15, v16, v17, v18, v19, v20, v21, v22, v23, v24, v25, v26, v27, v28, v29, v30, v31, v32, v33, v34, v35, v36, v37, v38, v39, v40, v41, v42, v43, v44, v45, v46, v47, v48, v49, v50;
  v0 = $0.attributes;
  v1 = $0.buffer;
  v2 = $0.context;
  v3 = $0.current;
  v4 = $0.draw;
  v5 = $0.elements;
  v6 = $0.extensions;
  v7 = $0.framebuffer;
  v8 = $0.gl;
  v9 = $0.isBufferArgs;
  v10 = $0.next;
  v11 = $0.shader;
  v12 = $0.strings;
  v13 = $0.timer;
  v14 = $0.uniforms;
  v15 = $0.vao;
  v16 = v10.blend_color;
  v17 = v3.blend_color;
  v18 = v10.blend_equation;
  v19 = v3.blend_equation;
  v20 = v10.blend_func;
  v21 = v3.blend_func;
  v22 = v10.colorMask;
  v23 = v3.colorMask;
  v24 = v10.depth_range;
  v25 = v3.depth_range;
  v26 = v10.polygonOffset_offset;
  v27 = v3.polygonOffset_offset;
  v28 = v10.sample_coverage;
  v29 = v3.sample_coverage;
  v30 = v10.scissor_box;
  v31 = v3.scissor_box;
  v32 = v10.stencil_func;
  v33 = v3.stencil_func;
  v34 = v10.stencil_opBack;
  v35 = v3.stencil_opBack;
  v36 = v10.stencil_opFront;
  v37 = v3.stencil_opFront;
  v38 = v10.viewport;
  v39 = v3.viewport;
  v40 = {
   'add': 32774, 'subtract': 32778, 'reverse subtract': 32779
  }
   ;
  v41 = {
   '0': 0, '1': 1, 'zero': 0, 'one': 1, 'src color': 768, 'one minus src color': 769, 'src alpha': 770, 'one minus src alpha': 771, 'dst color': 774, 'one minus dst color': 775, 'dst alpha': 772, 'one minus dst alpha': 773, 'constant color': 32769, 'one minus constant color': 32770, 'constant alpha': 32771, 'one minus constant alpha': 32772, 'src alpha saturate': 776
  }
   ;
  v42 = {
   'never': 512, 'less': 513, '<': 513, 'equal': 514, '=': 514, '==': 514, '===': 514, 'lequal': 515, '<=': 515, 'greater': 516, '>': 516, 'notequal': 517, '!=': 517, '!==': 517, 'gequal': 518, '>=': 518, 'always': 519
  }
   ;
  v43 = {
   'int8': 5120, 'int16': 5122, 'int32': 5124, 'uint8': 5121, 'uint16': 5123, 'uint32': 5125, 'float': 5126, 'float32': 5126
  }
   ;
  v44 = {
   'cw': 2304, 'ccw': 2305
  }
   ;
  v45 = {
   'points': 0, 'point': 0, 'lines': 1, 'line': 1, 'triangles': 4, 'triangle': 4, 'line loop': 2, 'line strip': 3, 'triangle strip': 5, 'triangle fan': 6
  }
   ;
  v46 = {
   '0': 0, 'zero': 0, 'keep': 7680, 'replace': 7681, 'increment': 7682, 'decrement': 7683, 'increment wrap': 34055, 'decrement wrap': 34056, 'invert': 5386
  }
   ;
  v47 = {
  }
   ;
  v47.buffer = $2;
  v47.divisor = 1;
  v48 = {
  }
   ;
  v48.buffer = $3;
  v48.divisor = 1;
  v49 = {
  }
   ;
  v49.buffer = $4;
  v49.divisor = 1;
  v50 = {
  }
   ;
  v50.buffer = $5;
  v50.divisor = 1;
  return {
   'batch': function (a0, a1) {
    var v397, v398, v432, v433, v434, v435, v436;
    v397 = v6.angle_instanced_arrays;
    v398 = v7.next;
    if (v398 !== v7.cur) {
     if (v398) {
      v8.bindFramebuffer(36160, v398.framebuffer);
     }
     else {
      v8.bindFramebuffer(36160, null);
     }
     v7.cur = v398;
    }
    if (v3.dirty) {
     var v399, v400, v401, v402, v403, v404, v405, v406, v407, v408, v409, v410, v411, v412, v413, v414, v415, v416, v417, v418, v419, v420, v421, v422, v423, v424, v425, v426, v427, v428, v429, v430, v431;
     v399 = v10.dither;
     if (v399 !== v3.dither) {
      if (v399) {
       v8.enable(3024);
      }
      else {
       v8.disable(3024);
      }
      v3.dither = v399;
     }
     v400 = v10.depth_func;
     if (v400 !== v3.depth_func) {
      v8.depthFunc(v400);
      v3.depth_func = v400;
     }
     v401 = v24[0];
     v402 = v24[1];
     if (v401 !== v25[0] || v402 !== v25[1]) {
      v8.depthRange(v401, v402);
      v25[0] = v401;
      v25[1] = v402;
     }
     v403 = v10.depth_mask;
     if (v403 !== v3.depth_mask) {
      v8.depthMask(v403);
      v3.depth_mask = v403;
     }
     v404 = v22[0];
     v405 = v22[1];
     v406 = v22[2];
     v407 = v22[3];
     if (v404 !== v23[0] || v405 !== v23[1] || v406 !== v23[2] || v407 !== v23[3]) {
      v8.colorMask(v404, v405, v406, v407);
      v23[0] = v404;
      v23[1] = v405;
      v23[2] = v406;
      v23[3] = v407;
     }
     v408 = v10.cull_enable;
     if (v408 !== v3.cull_enable) {
      if (v408) {
       v8.enable(2884);
      }
      else {
       v8.disable(2884);
      }
      v3.cull_enable = v408;
     }
     v409 = v10.cull_face;
     if (v409 !== v3.cull_face) {
      v8.cullFace(v409);
      v3.cull_face = v409;
     }
     v410 = v10.frontFace;
     if (v410 !== v3.frontFace) {
      v8.frontFace(v410);
      v3.frontFace = v410;
     }
     v411 = v10.lineWidth;
     if (v411 !== v3.lineWidth) {
      v8.lineWidth(v411);
      v3.lineWidth = v411;
     }
     v412 = v10.polygonOffset_enable;
     if (v412 !== v3.polygonOffset_enable) {
      if (v412) {
       v8.enable(32823);
      }
      else {
       v8.disable(32823);
      }
      v3.polygonOffset_enable = v412;
     }
     v413 = v26[0];
     v414 = v26[1];
     if (v413 !== v27[0] || v414 !== v27[1]) {
      v8.polygonOffset(v413, v414);
      v27[0] = v413;
      v27[1] = v414;
     }
     v415 = v10.sample_alpha;
     if (v415 !== v3.sample_alpha) {
      if (v415) {
       v8.enable(32926);
      }
      else {
       v8.disable(32926);
      }
      v3.sample_alpha = v415;
     }
     v416 = v10.sample_enable;
     if (v416 !== v3.sample_enable) {
      if (v416) {
       v8.enable(32928);
      }
      else {
       v8.disable(32928);
      }
      v3.sample_enable = v416;
     }
     v417 = v28[0];
     v418 = v28[1];
     if (v417 !== v29[0] || v418 !== v29[1]) {
      v8.sampleCoverage(v417, v418);
      v29[0] = v417;
      v29[1] = v418;
     }
     v419 = v10.stencil_enable;
     if (v419 !== v3.stencil_enable) {
      if (v419) {
       v8.enable(2960);
      }
      else {
       v8.disable(2960);
      }
      v3.stencil_enable = v419;
     }
     v420 = v10.stencil_mask;
     if (v420 !== v3.stencil_mask) {
      v8.stencilMask(v420);
      v3.stencil_mask = v420;
     }
     v421 = v32[0];
     v422 = v32[1];
     v423 = v32[2];
     if (v421 !== v33[0] || v422 !== v33[1] || v423 !== v33[2]) {
      v8.stencilFunc(v421, v422, v423);
      v33[0] = v421;
      v33[1] = v422;
      v33[2] = v423;
     }
     v424 = v36[0];
     v425 = v36[1];
     v426 = v36[2];
     v427 = v36[3];
     if (v424 !== v37[0] || v425 !== v37[1] || v426 !== v37[2] || v427 !== v37[3]) {
      v8.stencilOpSeparate(v424, v425, v426, v427);
      v37[0] = v424;
      v37[1] = v425;
      v37[2] = v426;
      v37[3] = v427;
     }
     v428 = v34[0];
     v429 = v34[1];
     v430 = v34[2];
     v431 = v34[3];
     if (v428 !== v35[0] || v429 !== v35[1] || v430 !== v35[2] || v431 !== v35[3]) {
      v8.stencilOpSeparate(v428, v429, v430, v431);
      v35[0] = v428;
      v35[1] = v429;
      v35[2] = v430;
      v35[3] = v431;
     }
    }
    v8.blendColor(0, 0, 0, 0);
    v17[0] = 0;
    v17[1] = 0;
    v17[2] = 0;
    v17[3] = 0;
    v8.enable(3042);
    v3.blend_enable = true;
    v8.blendEquationSeparate(32774, 32774);
    v19[0] = 32774;
    v19[1] = 32774;
    v8.blendFuncSeparate(770, 771, 773, 1);
    v21[0] = 770;
    v21[1] = 771;
    v21[2] = 773;
    v21[3] = 1;
    v8.disable(2929);
    v3.depth_enable = false;
    v8.enable(3089);
    v3.scissor_enable = true;
    v432 = v3.profile;
    if (v432) {
     v433 = performance.now();
     $1.count += a1;
    }
    v8.useProgram($27.program);
    v434 = v6.angle_instanced_arrays;
    var v449, v450, v451, v452, v453, v454, v558, v559;
    v15.setVAO(null);
    v449 = direction.location;
    v450 = v0[v449];
    if (!v450.buffer) {
     v8.enableVertexAttribArray(v449);
    }
    if (v450.type !== 5126 || v450.size !== 2 || v450.buffer !== $11 || v450.normalized !== false || v450.offset !== 0 || v450.stride !== 24) {
     v8.bindBuffer(34962, $11.buffer);
     v8.vertexAttribPointer(v449, 2, 5126, false, 24, 0);
     v450.type = 5126;
     v450.size = 2;
     v450.buffer = $11;
     v450.normalized = false;
     v450.offset = 0;
     v450.stride = 24;
    }
    if (v450.divisor !== 0) {
     v434.vertexAttribDivisorANGLE(v449, 0);
     v450.divisor = 0;
    }
    v451 = lineOffset.location;
    v452 = v0[v451];
    if (!v452.buffer) {
     v8.enableVertexAttribArray(v451);
    }
    if (v452.type !== 5126 || v452.size !== 2 || v452.buffer !== $12 || v452.normalized !== false || v452.offset !== 8 || v452.stride !== 24) {
     v8.bindBuffer(34962, $12.buffer);
     v8.vertexAttribPointer(v451, 2, 5126, false, 24, 8);
     v452.type = 5126;
     v452.size = 2;
     v452.buffer = $12;
     v452.normalized = false;
     v452.offset = 8;
     v452.stride = 24;
    }
    if (v452.divisor !== 0) {
     v434.vertexAttribDivisorANGLE(v451, 0);
     v452.divisor = 0;
    }
    v453 = capOffset.location;
    v454 = v0[v453];
    if (!v454.buffer) {
     v8.enableVertexAttribArray(v453);
    }
    if (v454.type !== 5126 || v454.size !== 2 || v454.buffer !== $13 || v454.normalized !== false || v454.offset !== 16 || v454.stride !== 24) {
     v8.bindBuffer(34962, $13.buffer);
     v8.vertexAttribPointer(v453, 2, 5126, false, 24, 16);
     v454.type = 5126;
     v454.size = 2;
     v454.buffer = $13;
     v454.normalized = false;
     v454.offset = 16;
     v454.stride = 24;
    }
    if (v454.divisor !== 0) {
     v434.vertexAttribDivisorANGLE(v453, 0);
     v454.divisor = 0;
    }
    v558 = v4.elements;
    if (v558) {
     v8.bindBuffer(34963, v558.buffer.buffer);
    }
    else if (v15.currentVAO) {
     v558 = v5.getElements(v15.currentVAO.elements);
     if (v558) v8.bindBuffer(34963, v558.buffer.buffer);
    }
    v559 = v4.offset;
    for (v435 = 0;
     v435 < a1;
     ++v435) {
     v436 = a0[v435];
     var v437, v438, v439, v440, v441, v442, v443, v444, v445, v446, v447, v448, v455, v456, v457, v458, v459, v460, v461, v462, v463, v464, v465, v466, v467, v468, v469, v470, v471, v472, v473, v474, v475, v476, v477, v478, v479, v480, v481, v482, v483, v484, v485, v486, v487, v488, v489, v490, v491, v492, v493, v494, v495, v496, v497, v498, v499, v500, v501, v502, v503, v504, v505, v506, v507, v508, v509, v510, v511, v512, v513, v514, v515, v516, v517, v518, v519, v520, v521, v522, v523, v524, v525, v526, v527, v528, v529, v530, v531, v532, v533, v534, v535, v536, v537, v538, v539, v540, v541, v542, v543, v544, v545, v546, v547, v548, v549, v550, v551, v552, v553, v554, v555, v556, v557, v560;
     v437 = v436['viewport'];
     v438 = v437.x | 0;
     v439 = v437.y | 0;
     v440 = 'width' in v437 ? v437.width | 0 : (v2.framebufferWidth - v438);
     v441 = 'height' in v437 ? v437.height | 0 : (v2.framebufferHeight - v439);
     v442 = v2.viewportWidth;
     v2.viewportWidth = v440;
     v443 = v2.viewportHeight;
     v2.viewportHeight = v441;
     v8.viewport(v438, v439, v440, v441);
     v39[0] = v438;
     v39[1] = v439;
     v39[2] = v440;
     v39[3] = v441;
     v444 = v436['viewport'];
     v445 = v444.x | 0;
     v446 = v444.y | 0;
     v447 = 'width' in v444 ? v444.width | 0 : (v2.framebufferWidth - v445);
     v448 = 'height' in v444 ? v444.height | 0 : (v2.framebufferHeight - v446);
     v8.scissor(v445, v446, v447, v448);
     v31[0] = v445;
     v31[1] = v446;
     v31[2] = v447;
     v31[3] = v448;
     v455 = $28.call(this, v2, v436, v435);
     v49.offset = v455;
     v456 = false;
     v457 = null;
     v458 = 0;
     v459 = false;
     v460 = 0;
     v461 = 0;
     v462 = 1;
     v463 = 0;
     v464 = 5126;
     v465 = 0;
     v466 = 0;
     v467 = 0;
     v468 = 0;
     if (v9(v49)) {
      v456 = true;
      v457 = v1.createStream(34962, v49);
      v464 = v457.dtype;
     }
     else {
      v457 = v1.getBuffer(v49);
      if (v457) {
       v464 = v457.dtype;
      }
      else if ('constant' in v49) {
       v462 = 2;
       if (typeof v49.constant === 'number') {
        v466 = v49.constant;
        v467 = v468 = v465 = 0;
       }
       else {
        v466 = v49.constant.length > 0 ? v49.constant[0] : 0;
        v467 = v49.constant.length > 1 ? v49.constant[1] : 0;
        v468 = v49.constant.length > 2 ? v49.constant[2] : 0;
        v465 = v49.constant.length > 3 ? v49.constant[3] : 0;
       }
      }
      else {
       if (v9(v49.buffer)) {
        v457 = v1.createStream(34962, v49.buffer);
       }
       else {
        v457 = v1.getBuffer(v49.buffer);
       }
       v464 = 'type' in v49 ? v43[v49.type] : v457.dtype;
       v459 = !!v49.normalized;
       v461 = v49.size | 0;
       v460 = v49.offset | 0;
       v463 = v49.stride | 0;
       v458 = v49.divisor | 0;
      }
     }
     v469 = position.location;
     v470 = v0[v469];
     if (v462 === 1) {
      if (!v470.buffer) {
       v8.enableVertexAttribArray(v469);
      }
      v471 = v461 || 2;
      if (v470.type !== v464 || v470.size !== v471 || v470.buffer !== v457 || v470.normalized !== v459 || v470.offset !== v460 || v470.stride !== v463) {
       v8.bindBuffer(34962, v457.buffer);
       v8.vertexAttribPointer(v469, v471, v464, v459, v463, v460);
       v470.type = v464;
       v470.size = v471;
       v470.buffer = v457;
       v470.normalized = v459;
       v470.offset = v460;
       v470.stride = v463;
      }
      if (v470.divisor !== v458) {
       v434.vertexAttribDivisorANGLE(v469, v458);
       v470.divisor = v458;
      }
     }
     else {
      if (v470.buffer) {
       v8.disableVertexAttribArray(v469);
       v470.buffer = null;
      }
      if (v470.x !== v466 || v470.y !== v467 || v470.z !== v468 || v470.w !== v465) {
       v8.vertexAttrib4f(v469, v466, v467, v468, v465);
       v470.x = v466;
       v470.y = v467;
       v470.z = v468;
       v470.w = v465;
      }
     }
     v472 = $29.call(this, v2, v436, v435);
     v50.offset = v472;
     v473 = false;
     v474 = null;
     v475 = 0;
     v476 = false;
     v477 = 0;
     v478 = 0;
     v479 = 1;
     v480 = 0;
     v481 = 5126;
     v482 = 0;
     v483 = 0;
     v484 = 0;
     v485 = 0;
     if (v9(v50)) {
      v473 = true;
      v474 = v1.createStream(34962, v50);
      v481 = v474.dtype;
     }
     else {
      v474 = v1.getBuffer(v50);
      if (v474) {
       v481 = v474.dtype;
      }
      else if ('constant' in v50) {
       v479 = 2;
       if (typeof v50.constant === 'number') {
        v483 = v50.constant;
        v484 = v485 = v482 = 0;
       }
       else {
        v483 = v50.constant.length > 0 ? v50.constant[0] : 0;
        v484 = v50.constant.length > 1 ? v50.constant[1] : 0;
        v485 = v50.constant.length > 2 ? v50.constant[2] : 0;
        v482 = v50.constant.length > 3 ? v50.constant[3] : 0;
       }
      }
      else {
       if (v9(v50.buffer)) {
        v474 = v1.createStream(34962, v50.buffer);
       }
       else {
        v474 = v1.getBuffer(v50.buffer);
       }
       v481 = 'type' in v50 ? v43[v50.type] : v474.dtype;
       v476 = !!v50.normalized;
       v478 = v50.size | 0;
       v477 = v50.offset | 0;
       v480 = v50.stride | 0;
       v475 = v50.divisor | 0;
      }
     }
     v486 = positionFract.location;
     v487 = v0[v486];
     if (v479 === 1) {
      if (!v487.buffer) {
       v8.enableVertexAttribArray(v486);
      }
      v488 = v478 || 2;
      if (v487.type !== v481 || v487.size !== v488 || v487.buffer !== v474 || v487.normalized !== v476 || v487.offset !== v477 || v487.stride !== v480) {
       v8.bindBuffer(34962, v474.buffer);
       v8.vertexAttribPointer(v486, v488, v481, v476, v480, v477);
       v487.type = v481;
       v487.size = v488;
       v487.buffer = v474;
       v487.normalized = v476;
       v487.offset = v477;
       v487.stride = v480;
      }
      if (v487.divisor !== v475) {
       v434.vertexAttribDivisorANGLE(v486, v475);
       v487.divisor = v475;
      }
     }
     else {
      if (v487.buffer) {
       v8.disableVertexAttribArray(v486);
       v487.buffer = null;
      }
      if (v487.x !== v483 || v487.y !== v484 || v487.z !== v485 || v487.w !== v482) {
       v8.vertexAttrib4f(v486, v483, v484, v485, v482);
       v487.x = v483;
       v487.y = v484;
       v487.z = v485;
       v487.w = v482;
      }
     }
     v489 = $30.call(this, v2, v436, v435);
     v48.offset = v489;
     v490 = false;
     v491 = null;
     v492 = 0;
     v493 = false;
     v494 = 0;
     v495 = 0;
     v496 = 1;
     v497 = 0;
     v498 = 5126;
     v499 = 0;
     v500 = 0;
     v501 = 0;
     v502 = 0;
     if (v9(v48)) {
      v490 = true;
      v491 = v1.createStream(34962, v48);
      v498 = v491.dtype;
     }
     else {
      v491 = v1.getBuffer(v48);
      if (v491) {
       v498 = v491.dtype;
      }
      else if ('constant' in v48) {
       v496 = 2;
       if (typeof v48.constant === 'number') {
        v500 = v48.constant;
        v501 = v502 = v499 = 0;
       }
       else {
        v500 = v48.constant.length > 0 ? v48.constant[0] : 0;
        v501 = v48.constant.length > 1 ? v48.constant[1] : 0;
        v502 = v48.constant.length > 2 ? v48.constant[2] : 0;
        v499 = v48.constant.length > 3 ? v48.constant[3] : 0;
       }
      }
      else {
       if (v9(v48.buffer)) {
        v491 = v1.createStream(34962, v48.buffer);
       }
       else {
        v491 = v1.getBuffer(v48.buffer);
       }
       v498 = 'type' in v48 ? v43[v48.type] : v491.dtype;
       v493 = !!v48.normalized;
       v495 = v48.size | 0;
       v494 = v48.offset | 0;
       v497 = v48.stride | 0;
       v492 = v48.divisor | 0;
      }
     }
     v503 = error.location;
     v504 = v0[v503];
     if (v496 === 1) {
      if (!v504.buffer) {
       v8.enableVertexAttribArray(v503);
      }
      v505 = v495 || 4;
      if (v504.type !== v498 || v504.size !== v505 || v504.buffer !== v491 || v504.normalized !== v493 || v504.offset !== v494 || v504.stride !== v497) {
       v8.bindBuffer(34962, v491.buffer);
       v8.vertexAttribPointer(v503, v505, v498, v493, v497, v494);
       v504.type = v498;
       v504.size = v505;
       v504.buffer = v491;
       v504.normalized = v493;
       v504.offset = v494;
       v504.stride = v497;
      }
      if (v504.divisor !== v492) {
       v434.vertexAttribDivisorANGLE(v503, v492);
       v504.divisor = v492;
      }
     }
     else {
      if (v504.buffer) {
       v8.disableVertexAttribArray(v503);
       v504.buffer = null;
      }
      if (v504.x !== v500 || v504.y !== v501 || v504.z !== v502 || v504.w !== v499) {
       v8.vertexAttrib4f(v503, v500, v501, v502, v499);
       v504.x = v500;
       v504.y = v501;
       v504.z = v502;
       v504.w = v499;
      }
     }
     v506 = $31.call(this, v2, v436, v435);
     v47.offset = v506;
     v507 = false;
     v508 = null;
     v509 = 0;
     v510 = false;
     v511 = 0;
     v512 = 0;
     v513 = 1;
     v514 = 0;
     v515 = 5126;
     v516 = 0;
     v517 = 0;
     v518 = 0;
     v519 = 0;
     if (v9(v47)) {
      v507 = true;
      v508 = v1.createStream(34962, v47);
      v515 = v508.dtype;
     }
     else {
      v508 = v1.getBuffer(v47);
      if (v508) {
       v515 = v508.dtype;
      }
      else if ('constant' in v47) {
       v513 = 2;
       if (typeof v47.constant === 'number') {
        v517 = v47.constant;
        v518 = v519 = v516 = 0;
       }
       else {
        v517 = v47.constant.length > 0 ? v47.constant[0] : 0;
        v518 = v47.constant.length > 1 ? v47.constant[1] : 0;
        v519 = v47.constant.length > 2 ? v47.constant[2] : 0;
        v516 = v47.constant.length > 3 ? v47.constant[3] : 0;
       }
      }
      else {
       if (v9(v47.buffer)) {
        v508 = v1.createStream(34962, v47.buffer);
       }
       else {
        v508 = v1.getBuffer(v47.buffer);
       }
       v515 = 'type' in v47 ? v43[v47.type] : v508.dtype;
       v510 = !!v47.normalized;
       v512 = v47.size | 0;
       v511 = v47.offset | 0;
       v514 = v47.stride | 0;
       v509 = v47.divisor | 0;
      }
     }
     v520 = color.location;
     v521 = v0[v520];
     if (v513 === 1) {
      if (!v521.buffer) {
       v8.enableVertexAttribArray(v520);
      }
      v522 = v512 || 4;
      if (v521.type !== v515 || v521.size !== v522 || v521.buffer !== v508 || v521.normalized !== v510 || v521.offset !== v511 || v521.stride !== v514) {
       v8.bindBuffer(34962, v508.buffer);
       v8.vertexAttribPointer(v520, v522, v515, v510, v514, v511);
       v521.type = v515;
       v521.size = v522;
       v521.buffer = v508;
       v521.normalized = v510;
       v521.offset = v511;
       v521.stride = v514;
      }
      if (v521.divisor !== v509) {
       v434.vertexAttribDivisorANGLE(v520, v509);
       v521.divisor = v509;
      }
     }
     else {
      if (v521.buffer) {
       v8.disableVertexAttribArray(v520);
       v521.buffer = null;
      }
      if (v521.x !== v517 || v521.y !== v518 || v521.z !== v519 || v521.w !== v516) {
       v8.vertexAttrib4f(v520, v517, v518, v519, v516);
       v521.x = v517;
       v521.y = v518;
       v521.z = v519;
       v521.w = v516;
      }
     }
     v523 = $32.call(this, v2, v436, v435);
     v524 = v523[0];
     v526 = v523[1];
     v528 = v523[2];
     v530 = v523[3];
     if (!v435 || v525 !== v524 || v527 !== v526 || v529 !== v528 || v531 !== v530) {
      v525 = v524;
      v527 = v526;
      v529 = v528;
      v531 = v530;
      v8.uniform4f(viewport.location, v524, v526, v528, v530);
     }
     v532 = v436['lineWidth'];
     if (!v435 || v533 !== v532) {
      v533 = v532;
      v8.uniform1f(lineWidth.location, v532);
     }
     v534 = v436['capSize'];
     if (!v435 || v535 !== v534) {
      v535 = v534;
      v8.uniform1f(capSize.location, v534);
     }
     v536 = v436['scale'];
     v537 = v536[0];
     v539 = v536[1];
     if (!v435 || v538 !== v537 || v540 !== v539) {
      v538 = v537;
      v540 = v539;
      v8.uniform2f(scale.location, v537, v539);
     }
     v541 = v436['scaleFract'];
     v542 = v541[0];
     v544 = v541[1];
     if (!v435 || v543 !== v542 || v545 !== v544) {
      v543 = v542;
      v545 = v544;
      v8.uniform2f(scaleFract.location, v542, v544);
     }
     v546 = v436['translate'];
     v547 = v546[0];
     v549 = v546[1];
     if (!v435 || v548 !== v547 || v550 !== v549) {
      v548 = v547;
      v550 = v549;
      v8.uniform2f(translate.location, v547, v549);
     }
     v551 = v436['translateFract'];
     v552 = v551[0];
     v554 = v551[1];
     if (!v435 || v553 !== v552 || v555 !== v554) {
      v553 = v552;
      v555 = v554;
      v8.uniform2f(translateFract.location, v552, v554);
     }
     v556 = v436['opacity'];
     if (!v435 || v557 !== v556) {
      v557 = v556;
      v8.uniform1f(opacity.location, v556);
     }
     v560 = v436['count'];
     if (v560 > 0) {
      if (v558) {
       v434.drawElementsInstancedANGLE(4, 36, v558.type, v559 << ((v558.type - 5121) >> 1), v560);
      }
      else {
       v434.drawArraysInstancedANGLE(4, v559, 36, v560);
      }
     }
     else if (v560 < 0) {
      if (v558) {
       v8.drawElements(4, 36, v558.type, v559 << ((v558.type - 5121) >> 1));
      }
      else {
       v8.drawArrays(4, v559, 36);
      }
     }
     v2.viewportWidth = v442;
     v2.viewportHeight = v443;
     if (v456) {
      v1.destroyStream(v457);
     }
     if (v473) {
      v1.destroyStream(v474);
     }
     if (v490) {
      v1.destroyStream(v491);
     }
     if (v507) {
      v1.destroyStream(v508);
     }
    }
    v3.dirty = true;
    v15.setVAO(null);
    if (v432) {
     $1.cpuTime += performance.now() - v433;
    }
   }
   , 'draw': function (a0) {
    var v51, v52, v86, v87, v88, v89, v90, v91, v92, v93, v94, v95, v96, v97, v98, v99, v100, v101, v102, v103, v104, v105, v106, v107, v108, v109, v110, v111, v112, v113, v114, v115, v116, v117, v118, v119, v120, v121, v122, v123, v124, v125, v126, v127, v128, v129, v130, v131, v132, v133, v134, v135, v136, v137, v138, v139, v140, v141, v142, v143, v144, v145, v146, v147, v148, v149, v150, v151, v152, v153, v154, v155, v156, v157, v158, v159, v160, v161, v162, v163, v164, v165, v166, v167, v168, v169, v170, v171, v172, v173, v174, v175, v176, v177, v178, v179, v180, v181, v182, v183, v184, v185, v186, v187, v188, v189, v190, v191, v192, v193, v194, v195, v196, v197;
    v51 = v6.angle_instanced_arrays;
    v52 = v7.next;
    if (v52 !== v7.cur) {
     if (v52) {
      v8.bindFramebuffer(36160, v52.framebuffer);
     }
     else {
      v8.bindFramebuffer(36160, null);
     }
     v7.cur = v52;
    }
    if (v3.dirty) {
     var v53, v54, v55, v56, v57, v58, v59, v60, v61, v62, v63, v64, v65, v66, v67, v68, v69, v70, v71, v72, v73, v74, v75, v76, v77, v78, v79, v80, v81, v82, v83, v84, v85;
     v53 = v10.dither;
     if (v53 !== v3.dither) {
      if (v53) {
       v8.enable(3024);
      }
      else {
       v8.disable(3024);
      }
      v3.dither = v53;
     }
     v54 = v10.depth_func;
     if (v54 !== v3.depth_func) {
      v8.depthFunc(v54);
      v3.depth_func = v54;
     }
     v55 = v24[0];
     v56 = v24[1];
     if (v55 !== v25[0] || v56 !== v25[1]) {
      v8.depthRange(v55, v56);
      v25[0] = v55;
      v25[1] = v56;
     }
     v57 = v10.depth_mask;
     if (v57 !== v3.depth_mask) {
      v8.depthMask(v57);
      v3.depth_mask = v57;
     }
     v58 = v22[0];
     v59 = v22[1];
     v60 = v22[2];
     v61 = v22[3];
     if (v58 !== v23[0] || v59 !== v23[1] || v60 !== v23[2] || v61 !== v23[3]) {
      v8.colorMask(v58, v59, v60, v61);
      v23[0] = v58;
      v23[1] = v59;
      v23[2] = v60;
      v23[3] = v61;
     }
     v62 = v10.cull_enable;
     if (v62 !== v3.cull_enable) {
      if (v62) {
       v8.enable(2884);
      }
      else {
       v8.disable(2884);
      }
      v3.cull_enable = v62;
     }
     v63 = v10.cull_face;
     if (v63 !== v3.cull_face) {
      v8.cullFace(v63);
      v3.cull_face = v63;
     }
     v64 = v10.frontFace;
     if (v64 !== v3.frontFace) {
      v8.frontFace(v64);
      v3.frontFace = v64;
     }
     v65 = v10.lineWidth;
     if (v65 !== v3.lineWidth) {
      v8.lineWidth(v65);
      v3.lineWidth = v65;
     }
     v66 = v10.polygonOffset_enable;
     if (v66 !== v3.polygonOffset_enable) {
      if (v66) {
       v8.enable(32823);
      }
      else {
       v8.disable(32823);
      }
      v3.polygonOffset_enable = v66;
     }
     v67 = v26[0];
     v68 = v26[1];
     if (v67 !== v27[0] || v68 !== v27[1]) {
      v8.polygonOffset(v67, v68);
      v27[0] = v67;
      v27[1] = v68;
     }
     v69 = v10.sample_alpha;
     if (v69 !== v3.sample_alpha) {
      if (v69) {
       v8.enable(32926);
      }
      else {
       v8.disable(32926);
      }
      v3.sample_alpha = v69;
     }
     v70 = v10.sample_enable;
     if (v70 !== v3.sample_enable) {
      if (v70) {
       v8.enable(32928);
      }
      else {
       v8.disable(32928);
      }
      v3.sample_enable = v70;
     }
     v71 = v28[0];
     v72 = v28[1];
     if (v71 !== v29[0] || v72 !== v29[1]) {
      v8.sampleCoverage(v71, v72);
      v29[0] = v71;
      v29[1] = v72;
     }
     v73 = v10.stencil_enable;
     if (v73 !== v3.stencil_enable) {
      if (v73) {
       v8.enable(2960);
      }
      else {
       v8.disable(2960);
      }
      v3.stencil_enable = v73;
     }
     v74 = v10.stencil_mask;
     if (v74 !== v3.stencil_mask) {
      v8.stencilMask(v74);
      v3.stencil_mask = v74;
     }
     v75 = v32[0];
     v76 = v32[1];
     v77 = v32[2];
     if (v75 !== v33[0] || v76 !== v33[1] || v77 !== v33[2]) {
      v8.stencilFunc(v75, v76, v77);
      v33[0] = v75;
      v33[1] = v76;
      v33[2] = v77;
     }
     v78 = v36[0];
     v79 = v36[1];
     v80 = v36[2];
     v81 = v36[3];
     if (v78 !== v37[0] || v79 !== v37[1] || v80 !== v37[2] || v81 !== v37[3]) {
      v8.stencilOpSeparate(v78, v79, v80, v81);
      v37[0] = v78;
      v37[1] = v79;
      v37[2] = v80;
      v37[3] = v81;
     }
     v82 = v34[0];
     v83 = v34[1];
     v84 = v34[2];
     v85 = v34[3];
     if (v82 !== v35[0] || v83 !== v35[1] || v84 !== v35[2] || v85 !== v35[3]) {
      v8.stencilOpSeparate(v82, v83, v84, v85);
      v35[0] = v82;
      v35[1] = v83;
      v35[2] = v84;
      v35[3] = v85;
     }
    }
    v86 = a0['viewport'];
    v87 = v86.x | 0;
    v88 = v86.y | 0;
    v89 = 'width' in v86 ? v86.width | 0 : (v2.framebufferWidth - v87);
    v90 = 'height' in v86 ? v86.height | 0 : (v2.framebufferHeight - v88);
    v91 = v2.viewportWidth;
    v2.viewportWidth = v89;
    v92 = v2.viewportHeight;
    v2.viewportHeight = v90;
    v8.viewport(v87, v88, v89, v90);
    v39[0] = v87;
    v39[1] = v88;
    v39[2] = v89;
    v39[3] = v90;
    v8.blendColor(0, 0, 0, 0);
    v17[0] = 0;
    v17[1] = 0;
    v17[2] = 0;
    v17[3] = 0;
    v8.enable(3042);
    v3.blend_enable = true;
    v8.blendEquationSeparate(32774, 32774);
    v19[0] = 32774;
    v19[1] = 32774;
    v8.blendFuncSeparate(770, 771, 773, 1);
    v21[0] = 770;
    v21[1] = 771;
    v21[2] = 773;
    v21[3] = 1;
    v8.disable(2929);
    v3.depth_enable = false;
    v93 = a0['viewport'];
    v94 = v93.x | 0;
    v95 = v93.y | 0;
    v96 = 'width' in v93 ? v93.width | 0 : (v2.framebufferWidth - v94);
    v97 = 'height' in v93 ? v93.height | 0 : (v2.framebufferHeight - v95);
    v8.scissor(v94, v95, v96, v97);
    v31[0] = v94;
    v31[1] = v95;
    v31[2] = v96;
    v31[3] = v97;
    v8.enable(3089);
    v3.scissor_enable = true;
    v98 = v3.profile;
    if (v98) {
     v99 = performance.now();
     $1.count++;
    }
    v8.useProgram($6.program);
    v100 = v6.angle_instanced_arrays;
    v15.setVAO(null);
    v101 = $7.call(this, v2, a0, 0);
    v49.offset = v101;
    v102 = false;
    v103 = null;
    v104 = 0;
    v105 = false;
    v106 = 0;
    v107 = 0;
    v108 = 1;
    v109 = 0;
    v110 = 5126;
    v111 = 0;
    v112 = 0;
    v113 = 0;
    v114 = 0;
    if (v9(v49)) {
     v102 = true;
     v103 = v1.createStream(34962, v49);
     v110 = v103.dtype;
    }
    else {
     v103 = v1.getBuffer(v49);
     if (v103) {
      v110 = v103.dtype;
     }
     else if ('constant' in v49) {
      v108 = 2;
      if (typeof v49.constant === 'number') {
       v112 = v49.constant;
       v113 = v114 = v111 = 0;
      }
      else {
       v112 = v49.constant.length > 0 ? v49.constant[0] : 0;
       v113 = v49.constant.length > 1 ? v49.constant[1] : 0;
       v114 = v49.constant.length > 2 ? v49.constant[2] : 0;
       v111 = v49.constant.length > 3 ? v49.constant[3] : 0;
      }
     }
     else {
      if (v9(v49.buffer)) {
       v103 = v1.createStream(34962, v49.buffer);
      }
      else {
       v103 = v1.getBuffer(v49.buffer);
      }
      v110 = 'type' in v49 ? v43[v49.type] : v103.dtype;
      v105 = !!v49.normalized;
      v107 = v49.size | 0;
      v106 = v49.offset | 0;
      v109 = v49.stride | 0;
      v104 = v49.divisor | 0;
     }
    }
    v115 = position.location;
    v116 = v0[v115];
    if (v108 === 1) {
     if (!v116.buffer) {
      v8.enableVertexAttribArray(v115);
     }
     v117 = v107 || 2;
     if (v116.type !== v110 || v116.size !== v117 || v116.buffer !== v103 || v116.normalized !== v105 || v116.offset !== v106 || v116.stride !== v109) {
      v8.bindBuffer(34962, v103.buffer);
      v8.vertexAttribPointer(v115, v117, v110, v105, v109, v106);
      v116.type = v110;
      v116.size = v117;
      v116.buffer = v103;
      v116.normalized = v105;
      v116.offset = v106;
      v116.stride = v109;
     }
     if (v116.divisor !== v104) {
      v100.vertexAttribDivisorANGLE(v115, v104);
      v116.divisor = v104;
     }
    }
    else {
     if (v116.buffer) {
      v8.disableVertexAttribArray(v115);
      v116.buffer = null;
     }
     if (v116.x !== v112 || v116.y !== v113 || v116.z !== v114 || v116.w !== v111) {
      v8.vertexAttrib4f(v115, v112, v113, v114, v111);
      v116.x = v112;
      v116.y = v113;
      v116.z = v114;
      v116.w = v111;
     }
    }
    v118 = $8.call(this, v2, a0, 0);
    v50.offset = v118;
    v119 = false;
    v120 = null;
    v121 = 0;
    v122 = false;
    v123 = 0;
    v124 = 0;
    v125 = 1;
    v126 = 0;
    v127 = 5126;
    v128 = 0;
    v129 = 0;
    v130 = 0;
    v131 = 0;
    if (v9(v50)) {
     v119 = true;
     v120 = v1.createStream(34962, v50);
     v127 = v120.dtype;
    }
    else {
     v120 = v1.getBuffer(v50);
     if (v120) {
      v127 = v120.dtype;
     }
     else if ('constant' in v50) {
      v125 = 2;
      if (typeof v50.constant === 'number') {
       v129 = v50.constant;
       v130 = v131 = v128 = 0;
      }
      else {
       v129 = v50.constant.length > 0 ? v50.constant[0] : 0;
       v130 = v50.constant.length > 1 ? v50.constant[1] : 0;
       v131 = v50.constant.length > 2 ? v50.constant[2] : 0;
       v128 = v50.constant.length > 3 ? v50.constant[3] : 0;
      }
     }
     else {
      if (v9(v50.buffer)) {
       v120 = v1.createStream(34962, v50.buffer);
      }
      else {
       v120 = v1.getBuffer(v50.buffer);
      }
      v127 = 'type' in v50 ? v43[v50.type] : v120.dtype;
      v122 = !!v50.normalized;
      v124 = v50.size | 0;
      v123 = v50.offset | 0;
      v126 = v50.stride | 0;
      v121 = v50.divisor | 0;
     }
    }
    v132 = positionFract.location;
    v133 = v0[v132];
    if (v125 === 1) {
     if (!v133.buffer) {
      v8.enableVertexAttribArray(v132);
     }
     v134 = v124 || 2;
     if (v133.type !== v127 || v133.size !== v134 || v133.buffer !== v120 || v133.normalized !== v122 || v133.offset !== v123 || v133.stride !== v126) {
      v8.bindBuffer(34962, v120.buffer);
      v8.vertexAttribPointer(v132, v134, v127, v122, v126, v123);
      v133.type = v127;
      v133.size = v134;
      v133.buffer = v120;
      v133.normalized = v122;
      v133.offset = v123;
      v133.stride = v126;
     }
     if (v133.divisor !== v121) {
      v100.vertexAttribDivisorANGLE(v132, v121);
      v133.divisor = v121;
     }
    }
    else {
     if (v133.buffer) {
      v8.disableVertexAttribArray(v132);
      v133.buffer = null;
     }
     if (v133.x !== v129 || v133.y !== v130 || v133.z !== v131 || v133.w !== v128) {
      v8.vertexAttrib4f(v132, v129, v130, v131, v128);
      v133.x = v129;
      v133.y = v130;
      v133.z = v131;
      v133.w = v128;
     }
    }
    v135 = $9.call(this, v2, a0, 0);
    v48.offset = v135;
    v136 = false;
    v137 = null;
    v138 = 0;
    v139 = false;
    v140 = 0;
    v141 = 0;
    v142 = 1;
    v143 = 0;
    v144 = 5126;
    v145 = 0;
    v146 = 0;
    v147 = 0;
    v148 = 0;
    if (v9(v48)) {
     v136 = true;
     v137 = v1.createStream(34962, v48);
     v144 = v137.dtype;
    }
    else {
     v137 = v1.getBuffer(v48);
     if (v137) {
      v144 = v137.dtype;
     }
     else if ('constant' in v48) {
      v142 = 2;
      if (typeof v48.constant === 'number') {
       v146 = v48.constant;
       v147 = v148 = v145 = 0;
      }
      else {
       v146 = v48.constant.length > 0 ? v48.constant[0] : 0;
       v147 = v48.constant.length > 1 ? v48.constant[1] : 0;
       v148 = v48.constant.length > 2 ? v48.constant[2] : 0;
       v145 = v48.constant.length > 3 ? v48.constant[3] : 0;
      }
     }
     else {
      if (v9(v48.buffer)) {
       v137 = v1.createStream(34962, v48.buffer);
      }
      else {
       v137 = v1.getBuffer(v48.buffer);
      }
      v144 = 'type' in v48 ? v43[v48.type] : v137.dtype;
      v139 = !!v48.normalized;
      v141 = v48.size | 0;
      v140 = v48.offset | 0;
      v143 = v48.stride | 0;
      v138 = v48.divisor | 0;
     }
    }
    v149 = error.location;
    v150 = v0[v149];
    if (v142 === 1) {
     if (!v150.buffer) {
      v8.enableVertexAttribArray(v149);
     }
     v151 = v141 || 4;
     if (v150.type !== v144 || v150.size !== v151 || v150.buffer !== v137 || v150.normalized !== v139 || v150.offset !== v140 || v150.stride !== v143) {
      v8.bindBuffer(34962, v137.buffer);
      v8.vertexAttribPointer(v149, v151, v144, v139, v143, v140);
      v150.type = v144;
      v150.size = v151;
      v150.buffer = v137;
      v150.normalized = v139;
      v150.offset = v140;
      v150.stride = v143;
     }
     if (v150.divisor !== v138) {
      v100.vertexAttribDivisorANGLE(v149, v138);
      v150.divisor = v138;
     }
    }
    else {
     if (v150.buffer) {
      v8.disableVertexAttribArray(v149);
      v150.buffer = null;
     }
     if (v150.x !== v146 || v150.y !== v147 || v150.z !== v148 || v150.w !== v145) {
      v8.vertexAttrib4f(v149, v146, v147, v148, v145);
      v150.x = v146;
      v150.y = v147;
      v150.z = v148;
      v150.w = v145;
     }
    }
    v152 = $10.call(this, v2, a0, 0);
    v47.offset = v152;
    v153 = false;
    v154 = null;
    v155 = 0;
    v156 = false;
    v157 = 0;
    v158 = 0;
    v159 = 1;
    v160 = 0;
    v161 = 5126;
    v162 = 0;
    v163 = 0;
    v164 = 0;
    v165 = 0;
    if (v9(v47)) {
     v153 = true;
     v154 = v1.createStream(34962, v47);
     v161 = v154.dtype;
    }
    else {
     v154 = v1.getBuffer(v47);
     if (v154) {
      v161 = v154.dtype;
     }
     else if ('constant' in v47) {
      v159 = 2;
      if (typeof v47.constant === 'number') {
       v163 = v47.constant;
       v164 = v165 = v162 = 0;
      }
      else {
       v163 = v47.constant.length > 0 ? v47.constant[0] : 0;
       v164 = v47.constant.length > 1 ? v47.constant[1] : 0;
       v165 = v47.constant.length > 2 ? v47.constant[2] : 0;
       v162 = v47.constant.length > 3 ? v47.constant[3] : 0;
      }
     }
     else {
      if (v9(v47.buffer)) {
       v154 = v1.createStream(34962, v47.buffer);
      }
      else {
       v154 = v1.getBuffer(v47.buffer);
      }
      v161 = 'type' in v47 ? v43[v47.type] : v154.dtype;
      v156 = !!v47.normalized;
      v158 = v47.size | 0;
      v157 = v47.offset | 0;
      v160 = v47.stride | 0;
      v155 = v47.divisor | 0;
     }
    }
    v166 = color.location;
    v167 = v0[v166];
    if (v159 === 1) {
     if (!v167.buffer) {
      v8.enableVertexAttribArray(v166);
     }
     v168 = v158 || 4;
     if (v167.type !== v161 || v167.size !== v168 || v167.buffer !== v154 || v167.normalized !== v156 || v167.offset !== v157 || v167.stride !== v160) {
      v8.bindBuffer(34962, v154.buffer);
      v8.vertexAttribPointer(v166, v168, v161, v156, v160, v157);
      v167.type = v161;
      v167.size = v168;
      v167.buffer = v154;
      v167.normalized = v156;
      v167.offset = v157;
      v167.stride = v160;
     }
     if (v167.divisor !== v155) {
      v100.vertexAttribDivisorANGLE(v166, v155);
      v167.divisor = v155;
     }
    }
    else {
     if (v167.buffer) {
      v8.disableVertexAttribArray(v166);
      v167.buffer = null;
     }
     if (v167.x !== v163 || v167.y !== v164 || v167.z !== v165 || v167.w !== v162) {
      v8.vertexAttrib4f(v166, v163, v164, v165, v162);
      v167.x = v163;
      v167.y = v164;
      v167.z = v165;
      v167.w = v162;
     }
    }
    v169 = direction.location;
    v170 = v0[v169];
    if (!v170.buffer) {
     v8.enableVertexAttribArray(v169);
    }
    if (v170.type !== 5126 || v170.size !== 2 || v170.buffer !== $11 || v170.normalized !== false || v170.offset !== 0 || v170.stride !== 24) {
     v8.bindBuffer(34962, $11.buffer);
     v8.vertexAttribPointer(v169, 2, 5126, false, 24, 0);
     v170.type = 5126;
     v170.size = 2;
     v170.buffer = $11;
     v170.normalized = false;
     v170.offset = 0;
     v170.stride = 24;
    }
    if (v170.divisor !== 0) {
     v100.vertexAttribDivisorANGLE(v169, 0);
     v170.divisor = 0;
    }
    v171 = lineOffset.location;
    v172 = v0[v171];
    if (!v172.buffer) {
     v8.enableVertexAttribArray(v171);
    }
    if (v172.type !== 5126 || v172.size !== 2 || v172.buffer !== $12 || v172.normalized !== false || v172.offset !== 8 || v172.stride !== 24) {
     v8.bindBuffer(34962, $12.buffer);
     v8.vertexAttribPointer(v171, 2, 5126, false, 24, 8);
     v172.type = 5126;
     v172.size = 2;
     v172.buffer = $12;
     v172.normalized = false;
     v172.offset = 8;
     v172.stride = 24;
    }
    if (v172.divisor !== 0) {
     v100.vertexAttribDivisorANGLE(v171, 0);
     v172.divisor = 0;
    }
    v173 = capOffset.location;
    v174 = v0[v173];
    if (!v174.buffer) {
     v8.enableVertexAttribArray(v173);
    }
    if (v174.type !== 5126 || v174.size !== 2 || v174.buffer !== $13 || v174.normalized !== false || v174.offset !== 16 || v174.stride !== 24) {
     v8.bindBuffer(34962, $13.buffer);
     v8.vertexAttribPointer(v173, 2, 5126, false, 24, 16);
     v174.type = 5126;
     v174.size = 2;
     v174.buffer = $13;
     v174.normalized = false;
     v174.offset = 16;
     v174.stride = 24;
    }
    if (v174.divisor !== 0) {
     v100.vertexAttribDivisorANGLE(v173, 0);
     v174.divisor = 0;
    }
    v175 = $14.call(this, v2, a0, 0);
    v176 = v175[0];
    v177 = v175[1];
    v178 = v175[2];
    v179 = v175[3];
    v8.uniform4f(viewport.location, v176, v177, v178, v179);
    v180 = a0['lineWidth'];
    v8.uniform1f(lineWidth.location, v180);
    v181 = a0['capSize'];
    v8.uniform1f(capSize.location, v181);
    v182 = a0['scale'];
    v183 = v182[0];
    v184 = v182[1];
    v8.uniform2f(scale.location, v183, v184);
    v185 = a0['scaleFract'];
    v186 = v185[0];
    v187 = v185[1];
    v8.uniform2f(scaleFract.location, v186, v187);
    v188 = a0['translate'];
    v189 = v188[0];
    v190 = v188[1];
    v8.uniform2f(translate.location, v189, v190);
    v191 = a0['translateFract'];
    v192 = v191[0];
    v193 = v191[1];
    v8.uniform2f(translateFract.location, v192, v193);
    v194 = a0['opacity'];
    v8.uniform1f(opacity.location, v194);
    v195 = v4.elements;
    if (v195) {
     v8.bindBuffer(34963, v195.buffer.buffer);
    }
    else if (v15.currentVAO) {
     v195 = v5.getElements(v15.currentVAO.elements);
     if (v195) v8.bindBuffer(34963, v195.buffer.buffer);
    }
    v196 = v4.offset;
    v197 = a0['count'];
    if (v197 > 0) {
     if (v195) {
      v100.drawElementsInstancedANGLE(4, 36, v195.type, v196 << ((v195.type - 5121) >> 1), v197);
     }
     else {
      v100.drawArraysInstancedANGLE(4, v196, 36, v197);
     }
    }
    else if (v197 < 0) {
     if (v195) {
      v8.drawElements(4, 36, v195.type, v196 << ((v195.type - 5121) >> 1));
     }
     else {
      v8.drawArrays(4, v196, 36);
     }
    }
    v3.dirty = true;
    v15.setVAO(null);
    v2.viewportWidth = v91;
    v2.viewportHeight = v92;
    if (v98) {
     $1.cpuTime += performance.now() - v99;
    }
    if (v102) {
     v1.destroyStream(v103);
    }
    if (v119) {
     v1.destroyStream(v120);
    }
    if (v136) {
     v1.destroyStream(v137);
    }
    if (v153) {
     v1.destroyStream(v154);
    }
   }
   , 'scope': function (a0, a1, a2) {
    var v198, v199, v200, v201, v202, v203, v204, v205, v206, v207, v208, v209, v210, v211, v212, v213, v214, v215, v216, v217, v218, v219, v220, v221, v222, v223, v224, v225, v226, v227, v228, v229, v230, v231, v232, v233, v234, v235, v236, v237, v238, v239, v240, v241, v242, v243, v244, v245, v246, v247, v248, v249, v250, v251, v252, v253, v254, v255, v256, v257, v258, v259, v260, v261, v262, v263, v264, v265, v266, v267, v268, v269, v270, v271, v272, v273, v274, v275, v276, v277, v278, v279, v280, v281, v282, v283, v284, v285, v286, v287, v288, v289, v290, v291, v292, v293, v294, v295, v296, v297, v298, v299, v300, v301, v302, v303, v304, v305, v306, v307, v308, v309, v310, v311, v312, v313, v314, v315, v316, v317, v318, v319, v320, v321, v322, v323, v324, v325, v326, v327, v328, v329, v330, v331, v332, v333, v334, v335, v336, v337, v338, v339, v340, v341, v342, v343, v344, v345, v346, v347, v348, v349, v350, v351, v352, v353, v354, v355, v356, v357, v358, v359, v360, v361, v362, v363, v364, v365, v366, v367, v368, v369, v370, v371, v372, v373, v374, v375, v376, v377, v378, v379, v380, v381, v382, v383, v384, v385, v386, v387, v388, v389, v390, v391, v392, v393, v394, v395, v396;
    v198 = a0['viewport'];
    v199 = v198.x | 0;
    v200 = v198.y | 0;
    v201 = 'width' in v198 ? v198.width | 0 : (v2.framebufferWidth - v199);
    v202 = 'height' in v198 ? v198.height | 0 : (v2.framebufferHeight - v200);
    v203 = v2.viewportWidth;
    v2.viewportWidth = v201;
    v204 = v2.viewportHeight;
    v2.viewportHeight = v202;
    v205 = v38[0];
    v38[0] = v199;
    v206 = v38[1];
    v38[1] = v200;
    v207 = v38[2];
    v38[2] = v201;
    v208 = v38[3];
    v38[3] = v202;
    v209 = v16[0];
    v16[0] = 0;
    v210 = v16[1];
    v16[1] = 0;
    v211 = v16[2];
    v16[2] = 0;
    v212 = v16[3];
    v16[3] = 0;
    v213 = v10.blend_enable;
    v10.blend_enable = true;
    v214 = v18[0];
    v18[0] = 32774;
    v215 = v18[1];
    v18[1] = 32774;
    v216 = v20[0];
    v20[0] = 770;
    v217 = v20[1];
    v20[1] = 771;
    v218 = v20[2];
    v20[2] = 773;
    v219 = v20[3];
    v20[3] = 1;
    v220 = v10.depth_enable;
    v10.depth_enable = false;
    v221 = a0['viewport'];
    v222 = v221.x | 0;
    v223 = v221.y | 0;
    v224 = 'width' in v221 ? v221.width | 0 : (v2.framebufferWidth - v222);
    v225 = 'height' in v221 ? v221.height | 0 : (v2.framebufferHeight - v223);
    v226 = v30[0];
    v30[0] = v222;
    v227 = v30[1];
    v30[1] = v223;
    v228 = v30[2];
    v30[2] = v224;
    v229 = v30[3];
    v30[3] = v225;
    v230 = v10.scissor_enable;
    v10.scissor_enable = true;
    v231 = v3.profile;
    if (v231) {
     v232 = performance.now();
     $1.count++;
    }
    v233 = v4.count;
    v4.count = 36;
    v234 = a0['count'];
    v235 = v4.instances;
    v4.instances = v234;
    v236 = v4.primitive;
    v4.primitive = 4;
    v237 = a0['capSize'];
    v238 = v14[5];
    v14[5] = v237;
    v239 = a0['lineWidth'];
    v240 = v14[4];
    v14[4] = v239;
    v241 = a0['opacity'];
    v242 = v14[10];
    v14[10] = v241;
    v243 = a0['range'];
    v244 = v14[18];
    v14[18] = v243;
    v245 = a0['scale'];
    v246 = v14[6];
    v14[6] = v245;
    v247 = a0['scaleFract'];
    v248 = v14[7];
    v14[7] = v247;
    v249 = a0['translate'];
    v250 = v14[8];
    v14[8] = v249;
    v251 = a0['translateFract'];
    v252 = v14[9];
    v14[9] = v251;
    v253 = $15.call(this, v2, a0, a2);
    v254 = v14[3];
    v14[3] = v253;
    v255 = $16.buffer;
    $16.buffer = $13;
    v256 = $16.divisor;
    $16.divisor = 0;
    v257 = $16.normalized;
    $16.normalized = false;
    v258 = $16.offset;
    $16.offset = 16;
    v259 = $16.size;
    $16.size = 0;
    v260 = $16.state;
    $16.state = 1;
    v261 = $16.stride;
    $16.stride = 24;
    v262 = $16.type;
    $16.type = 5126;
    v263 = $16.w;
    $16.w = 0;
    v264 = $16.x;
    $16.x = 0;
    v265 = $16.y;
    $16.y = 0;
    v266 = $16.z;
    $16.z = 0;
    v267 = $17.call(this, v2, a0, a2);
    v47.offset = v267;
    v268 = false;
    v269 = null;
    v270 = 0;
    v271 = false;
    v272 = 0;
    v273 = 0;
    v274 = 1;
    v275 = 0;
    v276 = 5126;
    v277 = 0;
    v278 = 0;
    v279 = 0;
    v280 = 0;
    if (v9(v47)) {
     v268 = true;
     v269 = v1.createStream(34962, v47);
     v276 = v269.dtype;
    }
    else {
     v269 = v1.getBuffer(v47);
     if (v269) {
      v276 = v269.dtype;
     }
     else if ('constant' in v47) {
      v274 = 2;
      if (typeof v47.constant === 'number') {
       v278 = v47.constant;
       v279 = v280 = v277 = 0;
      }
      else {
       v278 = v47.constant.length > 0 ? v47.constant[0] : 0;
       v279 = v47.constant.length > 1 ? v47.constant[1] : 0;
       v280 = v47.constant.length > 2 ? v47.constant[2] : 0;
       v277 = v47.constant.length > 3 ? v47.constant[3] : 0;
      }
     }
     else {
      if (v9(v47.buffer)) {
       v269 = v1.createStream(34962, v47.buffer);
      }
      else {
       v269 = v1.getBuffer(v47.buffer);
      }
      v276 = 'type' in v47 ? v43[v47.type] : v269.dtype;
      v271 = !!v47.normalized;
      v273 = v47.size | 0;
      v272 = v47.offset | 0;
      v275 = v47.stride | 0;
      v270 = v47.divisor | 0;
     }
    }
    v281 = $18.buffer;
    $18.buffer = v269;
    v282 = $18.divisor;
    $18.divisor = v270;
    v283 = $18.normalized;
    $18.normalized = v271;
    v284 = $18.offset;
    $18.offset = v272;
    v285 = $18.size;
    $18.size = v273;
    v286 = $18.state;
    $18.state = v274;
    v287 = $18.stride;
    $18.stride = v275;
    v288 = $18.type;
    $18.type = v276;
    v289 = $18.w;
    $18.w = v277;
    v290 = $18.x;
    $18.x = v278;
    v291 = $18.y;
    $18.y = v279;
    v292 = $18.z;
    $18.z = v280;
    v293 = $19.buffer;
    $19.buffer = $11;
    v294 = $19.divisor;
    $19.divisor = 0;
    v295 = $19.normalized;
    $19.normalized = false;
    v296 = $19.offset;
    $19.offset = 0;
    v297 = $19.size;
    $19.size = 0;
    v298 = $19.state;
    $19.state = 1;
    v299 = $19.stride;
    $19.stride = 24;
    v300 = $19.type;
    $19.type = 5126;
    v301 = $19.w;
    $19.w = 0;
    v302 = $19.x;
    $19.x = 0;
    v303 = $19.y;
    $19.y = 0;
    v304 = $19.z;
    $19.z = 0;
    v305 = $20.call(this, v2, a0, a2);
    v48.offset = v305;
    v306 = false;
    v307 = null;
    v308 = 0;
    v309 = false;
    v310 = 0;
    v311 = 0;
    v312 = 1;
    v313 = 0;
    v314 = 5126;
    v315 = 0;
    v316 = 0;
    v317 = 0;
    v318 = 0;
    if (v9(v48)) {
     v306 = true;
     v307 = v1.createStream(34962, v48);
     v314 = v307.dtype;
    }
    else {
     v307 = v1.getBuffer(v48);
     if (v307) {
      v314 = v307.dtype;
     }
     else if ('constant' in v48) {
      v312 = 2;
      if (typeof v48.constant === 'number') {
       v316 = v48.constant;
       v317 = v318 = v315 = 0;
      }
      else {
       v316 = v48.constant.length > 0 ? v48.constant[0] : 0;
       v317 = v48.constant.length > 1 ? v48.constant[1] : 0;
       v318 = v48.constant.length > 2 ? v48.constant[2] : 0;
       v315 = v48.constant.length > 3 ? v48.constant[3] : 0;
      }
     }
     else {
      if (v9(v48.buffer)) {
       v307 = v1.createStream(34962, v48.buffer);
      }
      else {
       v307 = v1.getBuffer(v48.buffer);
      }
      v314 = 'type' in v48 ? v43[v48.type] : v307.dtype;
      v309 = !!v48.normalized;
      v311 = v48.size | 0;
      v310 = v48.offset | 0;
      v313 = v48.stride | 0;
      v308 = v48.divisor | 0;
     }
    }
    v319 = $21.buffer;
    $21.buffer = v307;
    v320 = $21.divisor;
    $21.divisor = v308;
    v321 = $21.normalized;
    $21.normalized = v309;
    v322 = $21.offset;
    $21.offset = v310;
    v323 = $21.size;
    $21.size = v311;
    v324 = $21.state;
    $21.state = v312;
    v325 = $21.stride;
    $21.stride = v313;
    v326 = $21.type;
    $21.type = v314;
    v327 = $21.w;
    $21.w = v315;
    v328 = $21.x;
    $21.x = v316;
    v329 = $21.y;
    $21.y = v317;
    v330 = $21.z;
    $21.z = v318;
    v331 = $22.buffer;
    $22.buffer = $12;
    v332 = $22.divisor;
    $22.divisor = 0;
    v333 = $22.normalized;
    $22.normalized = false;
    v334 = $22.offset;
    $22.offset = 8;
    v335 = $22.size;
    $22.size = 0;
    v336 = $22.state;
    $22.state = 1;
    v337 = $22.stride;
    $22.stride = 24;
    v338 = $22.type;
    $22.type = 5126;
    v339 = $22.w;
    $22.w = 0;
    v340 = $22.x;
    $22.x = 0;
    v341 = $22.y;
    $22.y = 0;
    v342 = $22.z;
    $22.z = 0;
    v343 = $23.call(this, v2, a0, a2);
    v49.offset = v343;
    v344 = false;
    v345 = null;
    v346 = 0;
    v347 = false;
    v348 = 0;
    v349 = 0;
    v350 = 1;
    v351 = 0;
    v352 = 5126;
    v353 = 0;
    v354 = 0;
    v355 = 0;
    v356 = 0;
    if (v9(v49)) {
     v344 = true;
     v345 = v1.createStream(34962, v49);
     v352 = v345.dtype;
    }
    else {
     v345 = v1.getBuffer(v49);
     if (v345) {
      v352 = v345.dtype;
     }
     else if ('constant' in v49) {
      v350 = 2;
      if (typeof v49.constant === 'number') {
       v354 = v49.constant;
       v355 = v356 = v353 = 0;
      }
      else {
       v354 = v49.constant.length > 0 ? v49.constant[0] : 0;
       v355 = v49.constant.length > 1 ? v49.constant[1] : 0;
       v356 = v49.constant.length > 2 ? v49.constant[2] : 0;
       v353 = v49.constant.length > 3 ? v49.constant[3] : 0;
      }
     }
     else {
      if (v9(v49.buffer)) {
       v345 = v1.createStream(34962, v49.buffer);
      }
      else {
       v345 = v1.getBuffer(v49.buffer);
      }
      v352 = 'type' in v49 ? v43[v49.type] : v345.dtype;
      v347 = !!v49.normalized;
      v349 = v49.size | 0;
      v348 = v49.offset | 0;
      v351 = v49.stride | 0;
      v346 = v49.divisor | 0;
     }
    }
    v357 = $24.buffer;
    $24.buffer = v345;
    v358 = $24.divisor;
    $24.divisor = v346;
    v359 = $24.normalized;
    $24.normalized = v347;
    v360 = $24.offset;
    $24.offset = v348;
    v361 = $24.size;
    $24.size = v349;
    v362 = $24.state;
    $24.state = v350;
    v363 = $24.stride;
    $24.stride = v351;
    v364 = $24.type;
    $24.type = v352;
    v365 = $24.w;
    $24.w = v353;
    v366 = $24.x;
    $24.x = v354;
    v367 = $24.y;
    $24.y = v355;
    v368 = $24.z;
    $24.z = v356;
    v369 = $25.call(this, v2, a0, a2);
    v50.offset = v369;
    v370 = false;
    v371 = null;
    v372 = 0;
    v373 = false;
    v374 = 0;
    v375 = 0;
    v376 = 1;
    v377 = 0;
    v378 = 5126;
    v379 = 0;
    v380 = 0;
    v381 = 0;
    v382 = 0;
    if (v9(v50)) {
     v370 = true;
     v371 = v1.createStream(34962, v50);
     v378 = v371.dtype;
    }
    else {
     v371 = v1.getBuffer(v50);
     if (v371) {
      v378 = v371.dtype;
     }
     else if ('constant' in v50) {
      v376 = 2;
      if (typeof v50.constant === 'number') {
       v380 = v50.constant;
       v381 = v382 = v379 = 0;
      }
      else {
       v380 = v50.constant.length > 0 ? v50.constant[0] : 0;
       v381 = v50.constant.length > 1 ? v50.constant[1] : 0;
       v382 = v50.constant.length > 2 ? v50.constant[2] : 0;
       v379 = v50.constant.length > 3 ? v50.constant[3] : 0;
      }
     }
     else {
      if (v9(v50.buffer)) {
       v371 = v1.createStream(34962, v50.buffer);
      }
      else {
       v371 = v1.getBuffer(v50.buffer);
      }
      v378 = 'type' in v50 ? v43[v50.type] : v371.dtype;
      v373 = !!v50.normalized;
      v375 = v50.size | 0;
      v374 = v50.offset | 0;
      v377 = v50.stride | 0;
      v372 = v50.divisor | 0;
     }
    }
    v383 = $26.buffer;
    $26.buffer = v371;
    v384 = $26.divisor;
    $26.divisor = v372;
    v385 = $26.normalized;
    $26.normalized = v373;
    v386 = $26.offset;
    $26.offset = v374;
    v387 = $26.size;
    $26.size = v375;
    v388 = $26.state;
    $26.state = v376;
    v389 = $26.stride;
    $26.stride = v377;
    v390 = $26.type;
    $26.type = v378;
    v391 = $26.w;
    $26.w = v379;
    v392 = $26.x;
    $26.x = v380;
    v393 = $26.y;
    $26.y = v381;
    v394 = $26.z;
    $26.z = v382;
    v395 = v11.vert;
    v11.vert = 2;
    v396 = v11.frag;
    v11.frag = 1;
    v3.dirty = true;
    a1(v2, a0, a2);
    v2.viewportWidth = v203;
    v2.viewportHeight = v204;
    v38[0] = v205;
    v38[1] = v206;
    v38[2] = v207;
    v38[3] = v208;
    v16[0] = v209;
    v16[1] = v210;
    v16[2] = v211;
    v16[3] = v212;
    v10.blend_enable = v213;
    v18[0] = v214;
    v18[1] = v215;
    v20[0] = v216;
    v20[1] = v217;
    v20[2] = v218;
    v20[3] = v219;
    v10.depth_enable = v220;
    v30[0] = v226;
    v30[1] = v227;
    v30[2] = v228;
    v30[3] = v229;
    v10.scissor_enable = v230;
    if (v231) {
     $1.cpuTime += performance.now() - v232;
    }
    v4.count = v233;
    v4.instances = v235;
    v4.primitive = v236;
    v14[5] = v238;
    v14[4] = v240;
    v14[10] = v242;
    v14[18] = v244;
    v14[6] = v246;
    v14[7] = v248;
    v14[8] = v250;
    v14[9] = v252;
    v14[3] = v254;
    $16.buffer = v255;
    $16.divisor = v256;
    $16.normalized = v257;
    $16.offset = v258;
    $16.size = v259;
    $16.state = v260;
    $16.stride = v261;
    $16.type = v262;
    $16.w = v263;
    $16.x = v264;
    $16.y = v265;
    $16.z = v266;
    if (v268) {
     v1.destroyStream(v269);
    }
    $18.buffer = v281;
    $18.divisor = v282;
    $18.normalized = v283;
    $18.offset = v284;
    $18.size = v285;
    $18.state = v286;
    $18.stride = v287;
    $18.type = v288;
    $18.w = v289;
    $18.x = v290;
    $18.y = v291;
    $18.z = v292;
    $19.buffer = v293;
    $19.divisor = v294;
    $19.normalized = v295;
    $19.offset = v296;
    $19.size = v297;
    $19.state = v298;
    $19.stride = v299;
    $19.type = v300;
    $19.w = v301;
    $19.x = v302;
    $19.y = v303;
    $19.z = v304;
    if (v306) {
     v1.destroyStream(v307);
    }
    $21.buffer = v319;
    $21.divisor = v320;
    $21.normalized = v321;
    $21.offset = v322;
    $21.size = v323;
    $21.state = v324;
    $21.stride = v325;
    $21.type = v326;
    $21.w = v327;
    $21.x = v328;
    $21.y = v329;
    $21.z = v330;
    $22.buffer = v331;
    $22.divisor = v332;
    $22.normalized = v333;
    $22.offset = v334;
    $22.size = v335;
    $22.state = v336;
    $22.stride = v337;
    $22.type = v338;
    $22.w = v339;
    $22.x = v340;
    $22.y = v341;
    $22.z = v342;
    if (v344) {
     v1.destroyStream(v345);
    }
    $24.buffer = v357;
    $24.divisor = v358;
    $24.normalized = v359;
    $24.offset = v360;
    $24.size = v361;
    $24.state = v362;
    $24.stride = v363;
    $24.type = v364;
    $24.w = v365;
    $24.x = v366;
    $24.y = v367;
    $24.z = v368;
    if (v370) {
     v1.destroyStream(v371);
    }
    $26.buffer = v383;
    $26.divisor = v384;
    $26.normalized = v385;
    $26.offset = v386;
    $26.size = v387;
    $26.state = v388;
    $26.stride = v389;
    $26.type = v390;
    $26.w = v391;
    $26.x = v392;
    $26.y = v393;
    $26.z = v394;
    v11.vert = v395;
    v11.frag = v396;
    v3.dirty = true;
   }
   ,
  }

 },
 '$19,aCoord,aCoordFract,bCoord,bCoordFract,color,dashLength,dashTexture,depth,lineEnd,lineTop,opacity,scale,scaleFract,thickness,translate,translateFract,viewport': function ($0, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, aCoord, aCoordFract, bCoord, bCoordFract, color, dashLength, dashTexture, depth, lineEnd, lineTop, opacity, scale, scaleFract, thickness, translate, translateFract, viewport
 ) {
  'use strict';
  var v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15, v16, v17, v18, v19, v20, v21, v22, v23, v24, v25, v26, v27, v28, v29, v30, v31, v32, v33, v34, v35, v36, v37, v38, v39, v40, v41, v42, v43, v44, v45, v46, v47, v48, v49, v50, v51;
  v0 = $0.attributes;
  v1 = $0.buffer;
  v2 = $0.context;
  v3 = $0.current;
  v4 = $0.draw;
  v5 = $0.elements;
  v6 = $0.extensions;
  v7 = $0.framebuffer;
  v8 = $0.gl;
  v9 = $0.isBufferArgs;
  v10 = $0.next;
  v11 = $0.shader;
  v12 = $0.strings;
  v13 = $0.timer;
  v14 = $0.uniforms;
  v15 = $0.vao;
  v16 = v10.blend_color;
  v17 = v3.blend_color;
  v18 = v10.blend_equation;
  v19 = v3.blend_equation;
  v20 = v10.blend_func;
  v21 = v3.blend_func;
  v22 = v10.colorMask;
  v23 = v3.colorMask;
  v24 = v10.depth_range;
  v25 = v3.depth_range;
  v26 = v10.polygonOffset_offset;
  v27 = v3.polygonOffset_offset;
  v28 = v10.sample_coverage;
  v29 = v3.sample_coverage;
  v30 = v10.scissor_box;
  v31 = v3.scissor_box;
  v32 = v10.stencil_func;
  v33 = v3.stencil_func;
  v34 = v10.stencil_opBack;
  v35 = v3.stencil_opBack;
  v36 = v10.stencil_opFront;
  v37 = v3.stencil_opFront;
  v38 = v10.viewport;
  v39 = v3.viewport;
  v40 = {
   'add': 32774, 'subtract': 32778, 'reverse subtract': 32779
  }
   ;
  v41 = {
   '0': 0, '1': 1, 'zero': 0, 'one': 1, 'src color': 768, 'one minus src color': 769, 'src alpha': 770, 'one minus src alpha': 771, 'dst color': 774, 'one minus dst color': 775, 'dst alpha': 772, 'one minus dst alpha': 773, 'constant color': 32769, 'one minus constant color': 32770, 'constant alpha': 32771, 'one minus constant alpha': 32772, 'src alpha saturate': 776
  }
   ;
  v42 = {
   'never': 512, 'less': 513, '<': 513, 'equal': 514, '=': 514, '==': 514, '===': 514, 'lequal': 515, '<=': 515, 'greater': 516, '>': 516, 'notequal': 517, '!=': 517, '!==': 517, 'gequal': 518, '>=': 518, 'always': 519
  }
   ;
  v43 = {
   'int8': 5120, 'int16': 5122, 'int32': 5124, 'uint8': 5121, 'uint16': 5123, 'uint32': 5125, 'float': 5126, 'float32': 5126
  }
   ;
  v44 = {
   'cw': 2304, 'ccw': 2305
  }
   ;
  v45 = {
   'points': 0, 'point': 0, 'lines': 1, 'line': 1, 'triangles': 4, 'triangle': 4, 'line loop': 2, 'line strip': 3, 'triangle strip': 5, 'triangle fan': 6
  }
   ;
  v46 = {
   '0': 0, 'zero': 0, 'keep': 7680, 'replace': 7681, 'increment': 7682, 'decrement': 7683, 'increment wrap': 34055, 'decrement wrap': 34056, 'invert': 5386
  }
   ;
  v47 = {
  }
   ;
  v47.divisor = 1;
  v47.offset = 8;
  v47.stride = 8;
  v48 = {
  }
   ;
  v48.divisor = 1;
  v48.offset = 8;
  v48.stride = 8;
  v49 = {
  }
   ;
  v49.divisor = 1;
  v49.offset = 16;
  v49.stride = 8;
  v50 = {
  }
   ;
  v50.divisor = 1;
  v50.offset = 16;
  v50.stride = 8;
  v51 = {
  }
   ;
  v51.divisor = 1;
  v51.offset = 0;
  v51.stride = 4;
  return {
   'batch': function (a0, a1) {
    var v442, v443, v476, v477, v478, v479, v480;
    v442 = v6.angle_instanced_arrays;
    v443 = v7.next;
    if (v443 !== v7.cur) {
     if (v443) {
      v8.bindFramebuffer(36160, v443.framebuffer);
     }
     else {
      v8.bindFramebuffer(36160, null);
     }
     v7.cur = v443;
    }
    if (v3.dirty) {
     var v444, v445, v446, v447, v448, v449, v450, v451, v452, v453, v454, v455, v456, v457, v458, v459, v460, v461, v462, v463, v464, v465, v466, v467, v468, v469, v470, v471, v472, v473, v474, v475;
     v444 = v10.dither;
     if (v444 !== v3.dither) {
      if (v444) {
       v8.enable(3024);
      }
      else {
       v8.disable(3024);
      }
      v3.dither = v444;
     }
     v445 = v10.depth_func;
     if (v445 !== v3.depth_func) {
      v8.depthFunc(v445);
      v3.depth_func = v445;
     }
     v446 = v24[0];
     v447 = v24[1];
     if (v446 !== v25[0] || v447 !== v25[1]) {
      v8.depthRange(v446, v447);
      v25[0] = v446;
      v25[1] = v447;
     }
     v448 = v10.depth_mask;
     if (v448 !== v3.depth_mask) {
      v8.depthMask(v448);
      v3.depth_mask = v448;
     }
     v449 = v22[0];
     v450 = v22[1];
     v451 = v22[2];
     v452 = v22[3];
     if (v449 !== v23[0] || v450 !== v23[1] || v451 !== v23[2] || v452 !== v23[3]) {
      v8.colorMask(v449, v450, v451, v452);
      v23[0] = v449;
      v23[1] = v450;
      v23[2] = v451;
      v23[3] = v452;
     }
     v453 = v10.cull_enable;
     if (v453 !== v3.cull_enable) {
      if (v453) {
       v8.enable(2884);
      }
      else {
       v8.disable(2884);
      }
      v3.cull_enable = v453;
     }
     v454 = v10.cull_face;
     if (v454 !== v3.cull_face) {
      v8.cullFace(v454);
      v3.cull_face = v454;
     }
     v455 = v10.frontFace;
     if (v455 !== v3.frontFace) {
      v8.frontFace(v455);
      v3.frontFace = v455;
     }
     v456 = v10.lineWidth;
     if (v456 !== v3.lineWidth) {
      v8.lineWidth(v456);
      v3.lineWidth = v456;
     }
     v457 = v10.polygonOffset_enable;
     if (v457 !== v3.polygonOffset_enable) {
      if (v457) {
       v8.enable(32823);
      }
      else {
       v8.disable(32823);
      }
      v3.polygonOffset_enable = v457;
     }
     v458 = v26[0];
     v459 = v26[1];
     if (v458 !== v27[0] || v459 !== v27[1]) {
      v8.polygonOffset(v458, v459);
      v27[0] = v458;
      v27[1] = v459;
     }
     v460 = v10.sample_alpha;
     if (v460 !== v3.sample_alpha) {
      if (v460) {
       v8.enable(32926);
      }
      else {
       v8.disable(32926);
      }
      v3.sample_alpha = v460;
     }
     v461 = v10.sample_enable;
     if (v461 !== v3.sample_enable) {
      if (v461) {
       v8.enable(32928);
      }
      else {
       v8.disable(32928);
      }
      v3.sample_enable = v461;
     }
     v462 = v28[0];
     v463 = v28[1];
     if (v462 !== v29[0] || v463 !== v29[1]) {
      v8.sampleCoverage(v462, v463);
      v29[0] = v462;
      v29[1] = v463;
     }
     v464 = v10.stencil_mask;
     if (v464 !== v3.stencil_mask) {
      v8.stencilMask(v464);
      v3.stencil_mask = v464;
     }
     v465 = v32[0];
     v466 = v32[1];
     v467 = v32[2];
     if (v465 !== v33[0] || v466 !== v33[1] || v467 !== v33[2]) {
      v8.stencilFunc(v465, v466, v467);
      v33[0] = v465;
      v33[1] = v466;
      v33[2] = v467;
     }
     v468 = v36[0];
     v469 = v36[1];
     v470 = v36[2];
     v471 = v36[3];
     if (v468 !== v37[0] || v469 !== v37[1] || v470 !== v37[2] || v471 !== v37[3]) {
      v8.stencilOpSeparate(v468, v469, v470, v471);
      v37[0] = v468;
      v37[1] = v469;
      v37[2] = v470;
      v37[3] = v471;
     }
     v472 = v34[0];
     v473 = v34[1];
     v474 = v34[2];
     v475 = v34[3];
     if (v472 !== v35[0] || v473 !== v35[1] || v474 !== v35[2] || v475 !== v35[3]) {
      v8.stencilOpSeparate(v472, v473, v474, v475);
      v35[0] = v472;
      v35[1] = v473;
      v35[2] = v474;
      v35[3] = v475;
     }
    }
    v8.blendColor(0, 0, 0, 0);
    v17[0] = 0;
    v17[1] = 0;
    v17[2] = 0;
    v17[3] = 0;
    v8.enable(3042);
    v3.blend_enable = true;
    v8.blendEquationSeparate(32774, 32774);
    v19[0] = 32774;
    v19[1] = 32774;
    v8.blendFuncSeparate(770, 771, 773, 1);
    v21[0] = 770;
    v21[1] = 771;
    v21[2] = 773;
    v21[3] = 1;
    v8.enable(3089);
    v3.scissor_enable = true;
    v8.disable(2960);
    v3.stencil_enable = false;
    v476 = v3.profile;
    if (v476) {
     v477 = performance.now();
     $1.count += a1;
    }
    v8.useProgram($17.program);
    v478 = v6.angle_instanced_arrays;
    var v494, v495, v496, v497, v622;
    v15.setVAO(null);
    v494 = lineEnd.location;
    v495 = v0[v494];
    if (!v495.buffer) {
     v8.enableVertexAttribArray(v494);
    }
    if (v495.type !== 5126 || v495.size !== 1 || v495.buffer !== $4 || v495.normalized !== false || v495.offset !== 0 || v495.stride !== 8) {
     v8.bindBuffer(34962, $4.buffer);
     v8.vertexAttribPointer(v494, 1, 5126, false, 8, 0);
     v495.type = 5126;
     v495.size = 1;
     v495.buffer = $4;
     v495.normalized = false;
     v495.offset = 0;
     v495.stride = 8;
    }
    if (v495.divisor !== 0) {
     v478.vertexAttribDivisorANGLE(v494, 0);
     v495.divisor = 0;
    }
    v496 = lineTop.location;
    v497 = v0[v496];
    if (!v497.buffer) {
     v8.enableVertexAttribArray(v496);
    }
    if (v497.type !== 5126 || v497.size !== 1 || v497.buffer !== $5 || v497.normalized !== false || v497.offset !== 4 || v497.stride !== 8) {
     v8.bindBuffer(34962, $5.buffer);
     v8.vertexAttribPointer(v496, 1, 5126, false, 8, 4);
     v497.type = 5126;
     v497.size = 1;
     v497.buffer = $5;
     v497.normalized = false;
     v497.offset = 4;
     v497.stride = 8;
    }
    if (v497.divisor !== 0) {
     v478.vertexAttribDivisorANGLE(v496, 0);
     v497.divisor = 0;
    }
    v622 = v4.elements;
    if (v622) {
     v8.bindBuffer(34963, v622.buffer.buffer);
    }
    else if (v15.currentVAO) {
     v622 = v5.getElements(v15.currentVAO.elements);
     if (v622) v8.bindBuffer(34963, v622.buffer.buffer);
    }
    for (v479 = 0;
     v479 < a1;
     ++v479) {
     v480 = a0[v479];
     var v481, v482, v483, v484, v485, v486, v487, v488, v489, v490, v491, v492, v493, v498, v499, v500, v501, v502, v503, v504, v505, v506, v507, v508, v509, v510, v511, v512, v513, v514, v515, v516, v517, v518, v519, v520, v521, v522, v523, v524, v525, v526, v527, v528, v529, v530, v531, v532, v533, v534, v535, v536, v537, v538, v539, v540, v541, v542, v543, v544, v545, v546, v547, v548, v549, v550, v551, v552, v553, v554, v555, v556, v557, v558, v559, v560, v561, v562, v563, v564, v565, v566, v567, v568, v569, v570, v571, v572, v573, v574, v575, v576, v577, v578, v579, v580, v581, v582, v583, v584, v585, v586, v587, v588, v589, v590, v591, v592, v593, v594, v595, v596, v597, v598, v599, v600, v601, v602, v603, v604, v605, v606, v607, v608, v609, v610, v611, v612, v613, v614, v615, v616, v617, v618, v619, v620, v621, v623;
     v481 = v480['viewport'];
     v482 = v481.x | 0;
     v483 = v481.y | 0;
     v484 = 'width' in v481 ? v481.width | 0 : (v2.framebufferWidth - v482);
     v485 = 'height' in v481 ? v481.height | 0 : (v2.framebufferHeight - v483);
     v486 = v2.viewportWidth;
     v2.viewportWidth = v484;
     v487 = v2.viewportHeight;
     v2.viewportHeight = v485;
     v8.viewport(v482, v483, v484, v485);
     v39[0] = v482;
     v39[1] = v483;
     v39[2] = v484;
     v39[3] = v485;
     v488 = $18.call(this, v2, v480, v479);
     if (v488) {
      v8.enable(2929);
     }
     else {
      v8.disable(2929);
     }
     v3.depth_enable = v488;
     v489 = v480['viewport'];
     v490 = v489.x | 0;
     v491 = v489.y | 0;
     v492 = 'width' in v489 ? v489.width | 0 : (v2.framebufferWidth - v490);
     v493 = 'height' in v489 ? v489.height | 0 : (v2.framebufferHeight - v491);
     v8.scissor(v490, v491, v492, v493);
     v31[0] = v490;
     v31[1] = v491;
     v31[2] = v492;
     v31[3] = v493;
     v498 = v480['positionBuffer'];
     v47.buffer = v498;
     v499 = false;
     v500 = null;
     v501 = 0;
     v502 = false;
     v503 = 0;
     v504 = 0;
     v505 = 1;
     v506 = 0;
     v507 = 5126;
     v508 = 0;
     v509 = 0;
     v510 = 0;
     v511 = 0;
     if (v9(v47)) {
      v499 = true;
      v500 = v1.createStream(34962, v47);
      v507 = v500.dtype;
     }
     else {
      v500 = v1.getBuffer(v47);
      if (v500) {
       v507 = v500.dtype;
      }
      else if ('constant' in v47) {
       v505 = 2;
       if (typeof v47.constant === 'number') {
        v509 = v47.constant;
        v510 = v511 = v508 = 0;
       }
       else {
        v509 = v47.constant.length > 0 ? v47.constant[0] : 0;
        v510 = v47.constant.length > 1 ? v47.constant[1] : 0;
        v511 = v47.constant.length > 2 ? v47.constant[2] : 0;
        v508 = v47.constant.length > 3 ? v47.constant[3] : 0;
       }
      }
      else {
       if (v9(v47.buffer)) {
        v500 = v1.createStream(34962, v47.buffer);
       }
       else {
        v500 = v1.getBuffer(v47.buffer);
       }
       v507 = 'type' in v47 ? v43[v47.type] : v500.dtype;
       v502 = !!v47.normalized;
       v504 = v47.size | 0;
       v503 = v47.offset | 0;
       v506 = v47.stride | 0;
       v501 = v47.divisor | 0;
      }
     }
     v512 = aCoord.location;
     v513 = v0[v512];
     if (v505 === 1) {
      if (!v513.buffer) {
       v8.enableVertexAttribArray(v512);
      }
      v514 = v504 || 2;
      if (v513.type !== v507 || v513.size !== v514 || v513.buffer !== v500 || v513.normalized !== v502 || v513.offset !== v503 || v513.stride !== v506) {
       v8.bindBuffer(34962, v500.buffer);
       v8.vertexAttribPointer(v512, v514, v507, v502, v506, v503);
       v513.type = v507;
       v513.size = v514;
       v513.buffer = v500;
       v513.normalized = v502;
       v513.offset = v503;
       v513.stride = v506;
      }
      if (v513.divisor !== v501) {
       v478.vertexAttribDivisorANGLE(v512, v501);
       v513.divisor = v501;
      }
     }
     else {
      if (v513.buffer) {
       v8.disableVertexAttribArray(v512);
       v513.buffer = null;
      }
      if (v513.x !== v509 || v513.y !== v510 || v513.z !== v511 || v513.w !== v508) {
       v8.vertexAttrib4f(v512, v509, v510, v511, v508);
       v513.x = v509;
       v513.y = v510;
       v513.z = v511;
       v513.w = v508;
      }
     }
     v515 = v480['positionBuffer'];
     v49.buffer = v515;
     v516 = false;
     v517 = null;
     v518 = 0;
     v519 = false;
     v520 = 0;
     v521 = 0;
     v522 = 1;
     v523 = 0;
     v524 = 5126;
     v525 = 0;
     v526 = 0;
     v527 = 0;
     v528 = 0;
     if (v9(v49)) {
      v516 = true;
      v517 = v1.createStream(34962, v49);
      v524 = v517.dtype;
     }
     else {
      v517 = v1.getBuffer(v49);
      if (v517) {
       v524 = v517.dtype;
      }
      else if ('constant' in v49) {
       v522 = 2;
       if (typeof v49.constant === 'number') {
        v526 = v49.constant;
        v527 = v528 = v525 = 0;
       }
       else {
        v526 = v49.constant.length > 0 ? v49.constant[0] : 0;
        v527 = v49.constant.length > 1 ? v49.constant[1] : 0;
        v528 = v49.constant.length > 2 ? v49.constant[2] : 0;
        v525 = v49.constant.length > 3 ? v49.constant[3] : 0;
       }
      }
      else {
       if (v9(v49.buffer)) {
        v517 = v1.createStream(34962, v49.buffer);
       }
       else {
        v517 = v1.getBuffer(v49.buffer);
       }
       v524 = 'type' in v49 ? v43[v49.type] : v517.dtype;
       v519 = !!v49.normalized;
       v521 = v49.size | 0;
       v520 = v49.offset | 0;
       v523 = v49.stride | 0;
       v518 = v49.divisor | 0;
      }
     }
     v529 = bCoord.location;
     v530 = v0[v529];
     if (v522 === 1) {
      if (!v530.buffer) {
       v8.enableVertexAttribArray(v529);
      }
      v531 = v521 || 2;
      if (v530.type !== v524 || v530.size !== v531 || v530.buffer !== v517 || v530.normalized !== v519 || v530.offset !== v520 || v530.stride !== v523) {
       v8.bindBuffer(34962, v517.buffer);
       v8.vertexAttribPointer(v529, v531, v524, v519, v523, v520);
       v530.type = v524;
       v530.size = v531;
       v530.buffer = v517;
       v530.normalized = v519;
       v530.offset = v520;
       v530.stride = v523;
      }
      if (v530.divisor !== v518) {
       v478.vertexAttribDivisorANGLE(v529, v518);
       v530.divisor = v518;
      }
     }
     else {
      if (v530.buffer) {
       v8.disableVertexAttribArray(v529);
       v530.buffer = null;
      }
      if (v530.x !== v526 || v530.y !== v527 || v530.z !== v528 || v530.w !== v525) {
       v8.vertexAttrib4f(v529, v526, v527, v528, v525);
       v530.x = v526;
       v530.y = v527;
       v530.z = v528;
       v530.w = v525;
      }
     }
     v532 = v480['positionFractBuffer'];
     v48.buffer = v532;
     v533 = false;
     v534 = null;
     v535 = 0;
     v536 = false;
     v537 = 0;
     v538 = 0;
     v539 = 1;
     v540 = 0;
     v541 = 5126;
     v542 = 0;
     v543 = 0;
     v544 = 0;
     v545 = 0;
     if (v9(v48)) {
      v533 = true;
      v534 = v1.createStream(34962, v48);
      v541 = v534.dtype;
     }
     else {
      v534 = v1.getBuffer(v48);
      if (v534) {
       v541 = v534.dtype;
      }
      else if ('constant' in v48) {
       v539 = 2;
       if (typeof v48.constant === 'number') {
        v543 = v48.constant;
        v544 = v545 = v542 = 0;
       }
       else {
        v543 = v48.constant.length > 0 ? v48.constant[0] : 0;
        v544 = v48.constant.length > 1 ? v48.constant[1] : 0;
        v545 = v48.constant.length > 2 ? v48.constant[2] : 0;
        v542 = v48.constant.length > 3 ? v48.constant[3] : 0;
       }
      }
      else {
       if (v9(v48.buffer)) {
        v534 = v1.createStream(34962, v48.buffer);
       }
       else {
        v534 = v1.getBuffer(v48.buffer);
       }
       v541 = 'type' in v48 ? v43[v48.type] : v534.dtype;
       v536 = !!v48.normalized;
       v538 = v48.size | 0;
       v537 = v48.offset | 0;
       v540 = v48.stride | 0;
       v535 = v48.divisor | 0;
      }
     }
     v546 = aCoordFract.location;
     v547 = v0[v546];
     if (v539 === 1) {
      if (!v547.buffer) {
       v8.enableVertexAttribArray(v546);
      }
      v548 = v538 || 2;
      if (v547.type !== v541 || v547.size !== v548 || v547.buffer !== v534 || v547.normalized !== v536 || v547.offset !== v537 || v547.stride !== v540) {
       v8.bindBuffer(34962, v534.buffer);
       v8.vertexAttribPointer(v546, v548, v541, v536, v540, v537);
       v547.type = v541;
       v547.size = v548;
       v547.buffer = v534;
       v547.normalized = v536;
       v547.offset = v537;
       v547.stride = v540;
      }
      if (v547.divisor !== v535) {
       v478.vertexAttribDivisorANGLE(v546, v535);
       v547.divisor = v535;
      }
     }
     else {
      if (v547.buffer) {
       v8.disableVertexAttribArray(v546);
       v547.buffer = null;
      }
      if (v547.x !== v543 || v547.y !== v544 || v547.z !== v545 || v547.w !== v542) {
       v8.vertexAttrib4f(v546, v543, v544, v545, v542);
       v547.x = v543;
       v547.y = v544;
       v547.z = v545;
       v547.w = v542;
      }
     }
     v549 = v480['positionFractBuffer'];
     v50.buffer = v549;
     v550 = false;
     v551 = null;
     v552 = 0;
     v553 = false;
     v554 = 0;
     v555 = 0;
     v556 = 1;
     v557 = 0;
     v558 = 5126;
     v559 = 0;
     v560 = 0;
     v561 = 0;
     v562 = 0;
     if (v9(v50)) {
      v550 = true;
      v551 = v1.createStream(34962, v50);
      v558 = v551.dtype;
     }
     else {
      v551 = v1.getBuffer(v50);
      if (v551) {
       v558 = v551.dtype;
      }
      else if ('constant' in v50) {
       v556 = 2;
       if (typeof v50.constant === 'number') {
        v560 = v50.constant;
        v561 = v562 = v559 = 0;
       }
       else {
        v560 = v50.constant.length > 0 ? v50.constant[0] : 0;
        v561 = v50.constant.length > 1 ? v50.constant[1] : 0;
        v562 = v50.constant.length > 2 ? v50.constant[2] : 0;
        v559 = v50.constant.length > 3 ? v50.constant[3] : 0;
       }
      }
      else {
       if (v9(v50.buffer)) {
        v551 = v1.createStream(34962, v50.buffer);
       }
       else {
        v551 = v1.getBuffer(v50.buffer);
       }
       v558 = 'type' in v50 ? v43[v50.type] : v551.dtype;
       v553 = !!v50.normalized;
       v555 = v50.size | 0;
       v554 = v50.offset | 0;
       v557 = v50.stride | 0;
       v552 = v50.divisor | 0;
      }
     }
     v563 = bCoordFract.location;
     v564 = v0[v563];
     if (v556 === 1) {
      if (!v564.buffer) {
       v8.enableVertexAttribArray(v563);
      }
      v565 = v555 || 2;
      if (v564.type !== v558 || v564.size !== v565 || v564.buffer !== v551 || v564.normalized !== v553 || v564.offset !== v554 || v564.stride !== v557) {
       v8.bindBuffer(34962, v551.buffer);
       v8.vertexAttribPointer(v563, v565, v558, v553, v557, v554);
       v564.type = v558;
       v564.size = v565;
       v564.buffer = v551;
       v564.normalized = v553;
       v564.offset = v554;
       v564.stride = v557;
      }
      if (v564.divisor !== v552) {
       v478.vertexAttribDivisorANGLE(v563, v552);
       v564.divisor = v552;
      }
     }
     else {
      if (v564.buffer) {
       v8.disableVertexAttribArray(v563);
       v564.buffer = null;
      }
      if (v564.x !== v560 || v564.y !== v561 || v564.z !== v562 || v564.w !== v559) {
       v8.vertexAttrib4f(v563, v560, v561, v562, v559);
       v564.x = v560;
       v564.y = v561;
       v564.z = v562;
       v564.w = v559;
      }
     }
     v566 = v480['colorBuffer'];
     v51.buffer = v566;
     v567 = false;
     v568 = null;
     v569 = 0;
     v570 = false;
     v571 = 0;
     v572 = 0;
     v573 = 1;
     v574 = 0;
     v575 = 5126;
     v576 = 0;
     v577 = 0;
     v578 = 0;
     v579 = 0;
     if (v9(v51)) {
      v567 = true;
      v568 = v1.createStream(34962, v51);
      v575 = v568.dtype;
     }
     else {
      v568 = v1.getBuffer(v51);
      if (v568) {
       v575 = v568.dtype;
      }
      else if ('constant' in v51) {
       v573 = 2;
       if (typeof v51.constant === 'number') {
        v577 = v51.constant;
        v578 = v579 = v576 = 0;
       }
       else {
        v577 = v51.constant.length > 0 ? v51.constant[0] : 0;
        v578 = v51.constant.length > 1 ? v51.constant[1] : 0;
        v579 = v51.constant.length > 2 ? v51.constant[2] : 0;
        v576 = v51.constant.length > 3 ? v51.constant[3] : 0;
       }
      }
      else {
       if (v9(v51.buffer)) {
        v568 = v1.createStream(34962, v51.buffer);
       }
       else {
        v568 = v1.getBuffer(v51.buffer);
       }
       v575 = 'type' in v51 ? v43[v51.type] : v568.dtype;
       v570 = !!v51.normalized;
       v572 = v51.size | 0;
       v571 = v51.offset | 0;
       v574 = v51.stride | 0;
       v569 = v51.divisor | 0;
      }
     }
     v580 = color.location;
     v581 = v0[v580];
     if (v573 === 1) {
      if (!v581.buffer) {
       v8.enableVertexAttribArray(v580);
      }
      v582 = v572 || 4;
      if (v581.type !== v575 || v581.size !== v582 || v581.buffer !== v568 || v581.normalized !== v570 || v581.offset !== v571 || v581.stride !== v574) {
       v8.bindBuffer(34962, v568.buffer);
       v8.vertexAttribPointer(v580, v582, v575, v570, v574, v571);
       v581.type = v575;
       v581.size = v582;
       v581.buffer = v568;
       v581.normalized = v570;
       v581.offset = v571;
       v581.stride = v574;
      }
      if (v581.divisor !== v569) {
       v478.vertexAttribDivisorANGLE(v580, v569);
       v581.divisor = v569;
      }
     }
     else {
      if (v581.buffer) {
       v8.disableVertexAttribArray(v580);
       v581.buffer = null;
      }
      if (v581.x !== v577 || v581.y !== v578 || v581.z !== v579 || v581.w !== v576) {
       v8.vertexAttrib4f(v580, v577, v578, v579, v576);
       v581.x = v577;
       v581.y = v578;
       v581.z = v579;
       v581.w = v576;
      }
     }
     v583 = v480['scale'];
     v584 = v583[0];
     v586 = v583[1];
     if (!v479 || v585 !== v584 || v587 !== v586) {
      v585 = v584;
      v587 = v586;
      v8.uniform2f(scale.location, v584, v586);
     }
     v588 = v480['scaleFract'];
     v589 = v588[0];
     v591 = v588[1];
     if (!v479 || v590 !== v589 || v592 !== v591) {
      v590 = v589;
      v592 = v591;
      v8.uniform2f(scaleFract.location, v589, v591);
     }
     v593 = v480['translate'];
     v594 = v593[0];
     v596 = v593[1];
     if (!v479 || v595 !== v594 || v597 !== v596) {
      v595 = v594;
      v597 = v596;
      v8.uniform2f(translate.location, v594, v596);
     }
     v598 = v480['translateFract'];
     v599 = v598[0];
     v601 = v598[1];
     if (!v479 || v600 !== v599 || v602 !== v601) {
      v600 = v599;
      v602 = v601;
      v8.uniform2f(translateFract.location, v599, v601);
     }
     v603 = v480['thickness'];
     if (!v479 || v604 !== v603) {
      v604 = v603;
      v8.uniform1f(thickness.location, v603);
     }
     v605 = v480['depth'];
     if (!v479 || v606 !== v605) {
      v606 = v605;
      v8.uniform1f(depth.location, v605);
     }
     v607 = $19.call(this, v2, v480, v479);
     v608 = v607[0];
     v610 = v607[1];
     v612 = v607[2];
     v614 = v607[3];
     if (!v479 || v609 !== v608 || v611 !== v610 || v613 !== v612 || v615 !== v614) {
      v609 = v608;
      v611 = v610;
      v613 = v612;
      v615 = v614;
      v8.uniform4f(viewport.location, v608, v610, v612, v614);
     }
     v616 = v480['dashLength'];
     if (!v479 || v617 !== v616) {
      v617 = v616;
      v8.uniform1f(dashLength.location, v616);
     }
     v618 = v480['opacity'];
     if (!v479 || v619 !== v618) {
      v619 = v618;
      v8.uniform1f(opacity.location, v618);
     }
     v620 = v480['dashTexture'];
     if (v620 && v620._reglType === 'framebuffer') {
      v620 = v620.color[0];
     }
     v621 = v620._texture;
     v8.uniform1i(dashTexture.location, v621.bind());
     v623 = v480['count'];
     if (v623 > 0) {
      if (v622) {
       v478.drawElementsInstancedANGLE(5, 4, v622.type, 0 << ((v622.type - 5121) >> 1), v623);
      }
      else {
       v478.drawArraysInstancedANGLE(5, 0, 4, v623);
      }
     }
     else if (v623 < 0) {
      if (v622) {
       v8.drawElements(5, 4, v622.type, 0 << ((v622.type - 5121) >> 1));
      }
      else {
       v8.drawArrays(5, 0, 4);
      }
     }
     v2.viewportWidth = v486;
     v2.viewportHeight = v487;
     if (v499) {
      v1.destroyStream(v500);
     }
     if (v516) {
      v1.destroyStream(v517);
     }
     if (v533) {
      v1.destroyStream(v534);
     }
     if (v550) {
      v1.destroyStream(v551);
     }
     if (v567) {
      v1.destroyStream(v568);
     }
     v621.unbind();
    }
    v3.dirty = true;
    v15.setVAO(null);
    if (v476) {
     $1.cpuTime += performance.now() - v477;
    }
   }
   , 'draw': function (a0) {
    var v52, v53, v86, v87, v88, v89, v90, v91, v92, v93, v94, v95, v96, v97, v98, v99, v100, v101, v102, v103, v104, v105, v106, v107, v108, v109, v110, v111, v112, v113, v114, v115, v116, v117, v118, v119, v120, v121, v122, v123, v124, v125, v126, v127, v128, v129, v130, v131, v132, v133, v134, v135, v136, v137, v138, v139, v140, v141, v142, v143, v144, v145, v146, v147, v148, v149, v150, v151, v152, v153, v154, v155, v156, v157, v158, v159, v160, v161, v162, v163, v164, v165, v166, v167, v168, v169, v170, v171, v172, v173, v174, v175, v176, v177, v178, v179, v180, v181, v182, v183, v184, v185, v186, v187, v188, v189, v190, v191, v192, v193, v194, v195, v196, v197, v198, v199, v200, v201, v202, v203, v204, v205, v206, v207, v208, v209, v210, v211, v212, v213, v214, v215;
    v52 = v6.angle_instanced_arrays;
    v53 = v7.next;
    if (v53 !== v7.cur) {
     if (v53) {
      v8.bindFramebuffer(36160, v53.framebuffer);
     }
     else {
      v8.bindFramebuffer(36160, null);
     }
     v7.cur = v53;
    }
    if (v3.dirty) {
     var v54, v55, v56, v57, v58, v59, v60, v61, v62, v63, v64, v65, v66, v67, v68, v69, v70, v71, v72, v73, v74, v75, v76, v77, v78, v79, v80, v81, v82, v83, v84, v85;
     v54 = v10.dither;
     if (v54 !== v3.dither) {
      if (v54) {
       v8.enable(3024);
      }
      else {
       v8.disable(3024);
      }
      v3.dither = v54;
     }
     v55 = v10.depth_func;
     if (v55 !== v3.depth_func) {
      v8.depthFunc(v55);
      v3.depth_func = v55;
     }
     v56 = v24[0];
     v57 = v24[1];
     if (v56 !== v25[0] || v57 !== v25[1]) {
      v8.depthRange(v56, v57);
      v25[0] = v56;
      v25[1] = v57;
     }
     v58 = v10.depth_mask;
     if (v58 !== v3.depth_mask) {
      v8.depthMask(v58);
      v3.depth_mask = v58;
     }
     v59 = v22[0];
     v60 = v22[1];
     v61 = v22[2];
     v62 = v22[3];
     if (v59 !== v23[0] || v60 !== v23[1] || v61 !== v23[2] || v62 !== v23[3]) {
      v8.colorMask(v59, v60, v61, v62);
      v23[0] = v59;
      v23[1] = v60;
      v23[2] = v61;
      v23[3] = v62;
     }
     v63 = v10.cull_enable;
     if (v63 !== v3.cull_enable) {
      if (v63) {
       v8.enable(2884);
      }
      else {
       v8.disable(2884);
      }
      v3.cull_enable = v63;
     }
     v64 = v10.cull_face;
     if (v64 !== v3.cull_face) {
      v8.cullFace(v64);
      v3.cull_face = v64;
     }
     v65 = v10.frontFace;
     if (v65 !== v3.frontFace) {
      v8.frontFace(v65);
      v3.frontFace = v65;
     }
     v66 = v10.lineWidth;
     if (v66 !== v3.lineWidth) {
      v8.lineWidth(v66);
      v3.lineWidth = v66;
     }
     v67 = v10.polygonOffset_enable;
     if (v67 !== v3.polygonOffset_enable) {
      if (v67) {
       v8.enable(32823);
      }
      else {
       v8.disable(32823);
      }
      v3.polygonOffset_enable = v67;
     }
     v68 = v26[0];
     v69 = v26[1];
     if (v68 !== v27[0] || v69 !== v27[1]) {
      v8.polygonOffset(v68, v69);
      v27[0] = v68;
      v27[1] = v69;
     }
     v70 = v10.sample_alpha;
     if (v70 !== v3.sample_alpha) {
      if (v70) {
       v8.enable(32926);
      }
      else {
       v8.disable(32926);
      }
      v3.sample_alpha = v70;
     }
     v71 = v10.sample_enable;
     if (v71 !== v3.sample_enable) {
      if (v71) {
       v8.enable(32928);
      }
      else {
       v8.disable(32928);
      }
      v3.sample_enable = v71;
     }
     v72 = v28[0];
     v73 = v28[1];
     if (v72 !== v29[0] || v73 !== v29[1]) {
      v8.sampleCoverage(v72, v73);
      v29[0] = v72;
      v29[1] = v73;
     }
     v74 = v10.stencil_mask;
     if (v74 !== v3.stencil_mask) {
      v8.stencilMask(v74);
      v3.stencil_mask = v74;
     }
     v75 = v32[0];
     v76 = v32[1];
     v77 = v32[2];
     if (v75 !== v33[0] || v76 !== v33[1] || v77 !== v33[2]) {
      v8.stencilFunc(v75, v76, v77);
      v33[0] = v75;
      v33[1] = v76;
      v33[2] = v77;
     }
     v78 = v36[0];
     v79 = v36[1];
     v80 = v36[2];
     v81 = v36[3];
     if (v78 !== v37[0] || v79 !== v37[1] || v80 !== v37[2] || v81 !== v37[3]) {
      v8.stencilOpSeparate(v78, v79, v80, v81);
      v37[0] = v78;
      v37[1] = v79;
      v37[2] = v80;
      v37[3] = v81;
     }
     v82 = v34[0];
     v83 = v34[1];
     v84 = v34[2];
     v85 = v34[3];
     if (v82 !== v35[0] || v83 !== v35[1] || v84 !== v35[2] || v85 !== v35[3]) {
      v8.stencilOpSeparate(v82, v83, v84, v85);
      v35[0] = v82;
      v35[1] = v83;
      v35[2] = v84;
      v35[3] = v85;
     }
    }
    v86 = a0['viewport'];
    v87 = v86.x | 0;
    v88 = v86.y | 0;
    v89 = 'width' in v86 ? v86.width | 0 : (v2.framebufferWidth - v87);
    v90 = 'height' in v86 ? v86.height | 0 : (v2.framebufferHeight - v88);
    v91 = v2.viewportWidth;
    v2.viewportWidth = v89;
    v92 = v2.viewportHeight;
    v2.viewportHeight = v90;
    v8.viewport(v87, v88, v89, v90);
    v39[0] = v87;
    v39[1] = v88;
    v39[2] = v89;
    v39[3] = v90;
    v8.blendColor(0, 0, 0, 0);
    v17[0] = 0;
    v17[1] = 0;
    v17[2] = 0;
    v17[3] = 0;
    v8.enable(3042);
    v3.blend_enable = true;
    v8.blendEquationSeparate(32774, 32774);
    v19[0] = 32774;
    v19[1] = 32774;
    v8.blendFuncSeparate(770, 771, 773, 1);
    v21[0] = 770;
    v21[1] = 771;
    v21[2] = 773;
    v21[3] = 1;
    v93 = $2.call(this, v2, a0, 0);
    if (v93) {
     v8.enable(2929);
    }
    else {
     v8.disable(2929);
    }
    v3.depth_enable = v93;
    v94 = a0['viewport'];
    v95 = v94.x | 0;
    v96 = v94.y | 0;
    v97 = 'width' in v94 ? v94.width | 0 : (v2.framebufferWidth - v95);
    v98 = 'height' in v94 ? v94.height | 0 : (v2.framebufferHeight - v96);
    v8.scissor(v95, v96, v97, v98);
    v31[0] = v95;
    v31[1] = v96;
    v31[2] = v97;
    v31[3] = v98;
    v8.enable(3089);
    v3.scissor_enable = true;
    v8.disable(2960);
    v3.stencil_enable = false;
    v99 = v3.profile;
    if (v99) {
     v100 = performance.now();
     $1.count++;
    }
    v8.useProgram($3.program);
    v101 = v6.angle_instanced_arrays;
    v15.setVAO(null);
    v102 = a0['positionBuffer'];
    v47.buffer = v102;
    v103 = false;
    v104 = null;
    v105 = 0;
    v106 = false;
    v107 = 0;
    v108 = 0;
    v109 = 1;
    v110 = 0;
    v111 = 5126;
    v112 = 0;
    v113 = 0;
    v114 = 0;
    v115 = 0;
    if (v9(v47)) {
     v103 = true;
     v104 = v1.createStream(34962, v47);
     v111 = v104.dtype;
    }
    else {
     v104 = v1.getBuffer(v47);
     if (v104) {
      v111 = v104.dtype;
     }
     else if ('constant' in v47) {
      v109 = 2;
      if (typeof v47.constant === 'number') {
       v113 = v47.constant;
       v114 = v115 = v112 = 0;
      }
      else {
       v113 = v47.constant.length > 0 ? v47.constant[0] : 0;
       v114 = v47.constant.length > 1 ? v47.constant[1] : 0;
       v115 = v47.constant.length > 2 ? v47.constant[2] : 0;
       v112 = v47.constant.length > 3 ? v47.constant[3] : 0;
      }
     }
     else {
      if (v9(v47.buffer)) {
       v104 = v1.createStream(34962, v47.buffer);
      }
      else {
       v104 = v1.getBuffer(v47.buffer);
      }
      v111 = 'type' in v47 ? v43[v47.type] : v104.dtype;
      v106 = !!v47.normalized;
      v108 = v47.size | 0;
      v107 = v47.offset | 0;
      v110 = v47.stride | 0;
      v105 = v47.divisor | 0;
     }
    }
    v116 = aCoord.location;
    v117 = v0[v116];
    if (v109 === 1) {
     if (!v117.buffer) {
      v8.enableVertexAttribArray(v116);
     }
     v118 = v108 || 2;
     if (v117.type !== v111 || v117.size !== v118 || v117.buffer !== v104 || v117.normalized !== v106 || v117.offset !== v107 || v117.stride !== v110) {
      v8.bindBuffer(34962, v104.buffer);
      v8.vertexAttribPointer(v116, v118, v111, v106, v110, v107);
      v117.type = v111;
      v117.size = v118;
      v117.buffer = v104;
      v117.normalized = v106;
      v117.offset = v107;
      v117.stride = v110;
     }
     if (v117.divisor !== v105) {
      v101.vertexAttribDivisorANGLE(v116, v105);
      v117.divisor = v105;
     }
    }
    else {
     if (v117.buffer) {
      v8.disableVertexAttribArray(v116);
      v117.buffer = null;
     }
     if (v117.x !== v113 || v117.y !== v114 || v117.z !== v115 || v117.w !== v112) {
      v8.vertexAttrib4f(v116, v113, v114, v115, v112);
      v117.x = v113;
      v117.y = v114;
      v117.z = v115;
      v117.w = v112;
     }
    }
    v119 = a0['positionBuffer'];
    v49.buffer = v119;
    v120 = false;
    v121 = null;
    v122 = 0;
    v123 = false;
    v124 = 0;
    v125 = 0;
    v126 = 1;
    v127 = 0;
    v128 = 5126;
    v129 = 0;
    v130 = 0;
    v131 = 0;
    v132 = 0;
    if (v9(v49)) {
     v120 = true;
     v121 = v1.createStream(34962, v49);
     v128 = v121.dtype;
    }
    else {
     v121 = v1.getBuffer(v49);
     if (v121) {
      v128 = v121.dtype;
     }
     else if ('constant' in v49) {
      v126 = 2;
      if (typeof v49.constant === 'number') {
       v130 = v49.constant;
       v131 = v132 = v129 = 0;
      }
      else {
       v130 = v49.constant.length > 0 ? v49.constant[0] : 0;
       v131 = v49.constant.length > 1 ? v49.constant[1] : 0;
       v132 = v49.constant.length > 2 ? v49.constant[2] : 0;
       v129 = v49.constant.length > 3 ? v49.constant[3] : 0;
      }
     }
     else {
      if (v9(v49.buffer)) {
       v121 = v1.createStream(34962, v49.buffer);
      }
      else {
       v121 = v1.getBuffer(v49.buffer);
      }
      v128 = 'type' in v49 ? v43[v49.type] : v121.dtype;
      v123 = !!v49.normalized;
      v125 = v49.size | 0;
      v124 = v49.offset | 0;
      v127 = v49.stride | 0;
      v122 = v49.divisor | 0;
     }
    }
    v133 = bCoord.location;
    v134 = v0[v133];
    if (v126 === 1) {
     if (!v134.buffer) {
      v8.enableVertexAttribArray(v133);
     }
     v135 = v125 || 2;
     if (v134.type !== v128 || v134.size !== v135 || v134.buffer !== v121 || v134.normalized !== v123 || v134.offset !== v124 || v134.stride !== v127) {
      v8.bindBuffer(34962, v121.buffer);
      v8.vertexAttribPointer(v133, v135, v128, v123, v127, v124);
      v134.type = v128;
      v134.size = v135;
      v134.buffer = v121;
      v134.normalized = v123;
      v134.offset = v124;
      v134.stride = v127;
     }
     if (v134.divisor !== v122) {
      v101.vertexAttribDivisorANGLE(v133, v122);
      v134.divisor = v122;
     }
    }
    else {
     if (v134.buffer) {
      v8.disableVertexAttribArray(v133);
      v134.buffer = null;
     }
     if (v134.x !== v130 || v134.y !== v131 || v134.z !== v132 || v134.w !== v129) {
      v8.vertexAttrib4f(v133, v130, v131, v132, v129);
      v134.x = v130;
      v134.y = v131;
      v134.z = v132;
      v134.w = v129;
     }
    }
    v136 = a0['positionFractBuffer'];
    v48.buffer = v136;
    v137 = false;
    v138 = null;
    v139 = 0;
    v140 = false;
    v141 = 0;
    v142 = 0;
    v143 = 1;
    v144 = 0;
    v145 = 5126;
    v146 = 0;
    v147 = 0;
    v148 = 0;
    v149 = 0;
    if (v9(v48)) {
     v137 = true;
     v138 = v1.createStream(34962, v48);
     v145 = v138.dtype;
    }
    else {
     v138 = v1.getBuffer(v48);
     if (v138) {
      v145 = v138.dtype;
     }
     else if ('constant' in v48) {
      v143 = 2;
      if (typeof v48.constant === 'number') {
       v147 = v48.constant;
       v148 = v149 = v146 = 0;
      }
      else {
       v147 = v48.constant.length > 0 ? v48.constant[0] : 0;
       v148 = v48.constant.length > 1 ? v48.constant[1] : 0;
       v149 = v48.constant.length > 2 ? v48.constant[2] : 0;
       v146 = v48.constant.length > 3 ? v48.constant[3] : 0;
      }
     }
     else {
      if (v9(v48.buffer)) {
       v138 = v1.createStream(34962, v48.buffer);
      }
      else {
       v138 = v1.getBuffer(v48.buffer);
      }
      v145 = 'type' in v48 ? v43[v48.type] : v138.dtype;
      v140 = !!v48.normalized;
      v142 = v48.size | 0;
      v141 = v48.offset | 0;
      v144 = v48.stride | 0;
      v139 = v48.divisor | 0;
     }
    }
    v150 = aCoordFract.location;
    v151 = v0[v150];
    if (v143 === 1) {
     if (!v151.buffer) {
      v8.enableVertexAttribArray(v150);
     }
     v152 = v142 || 2;
     if (v151.type !== v145 || v151.size !== v152 || v151.buffer !== v138 || v151.normalized !== v140 || v151.offset !== v141 || v151.stride !== v144) {
      v8.bindBuffer(34962, v138.buffer);
      v8.vertexAttribPointer(v150, v152, v145, v140, v144, v141);
      v151.type = v145;
      v151.size = v152;
      v151.buffer = v138;
      v151.normalized = v140;
      v151.offset = v141;
      v151.stride = v144;
     }
     if (v151.divisor !== v139) {
      v101.vertexAttribDivisorANGLE(v150, v139);
      v151.divisor = v139;
     }
    }
    else {
     if (v151.buffer) {
      v8.disableVertexAttribArray(v150);
      v151.buffer = null;
     }
     if (v151.x !== v147 || v151.y !== v148 || v151.z !== v149 || v151.w !== v146) {
      v8.vertexAttrib4f(v150, v147, v148, v149, v146);
      v151.x = v147;
      v151.y = v148;
      v151.z = v149;
      v151.w = v146;
     }
    }
    v153 = a0['positionFractBuffer'];
    v50.buffer = v153;
    v154 = false;
    v155 = null;
    v156 = 0;
    v157 = false;
    v158 = 0;
    v159 = 0;
    v160 = 1;
    v161 = 0;
    v162 = 5126;
    v163 = 0;
    v164 = 0;
    v165 = 0;
    v166 = 0;
    if (v9(v50)) {
     v154 = true;
     v155 = v1.createStream(34962, v50);
     v162 = v155.dtype;
    }
    else {
     v155 = v1.getBuffer(v50);
     if (v155) {
      v162 = v155.dtype;
     }
     else if ('constant' in v50) {
      v160 = 2;
      if (typeof v50.constant === 'number') {
       v164 = v50.constant;
       v165 = v166 = v163 = 0;
      }
      else {
       v164 = v50.constant.length > 0 ? v50.constant[0] : 0;
       v165 = v50.constant.length > 1 ? v50.constant[1] : 0;
       v166 = v50.constant.length > 2 ? v50.constant[2] : 0;
       v163 = v50.constant.length > 3 ? v50.constant[3] : 0;
      }
     }
     else {
      if (v9(v50.buffer)) {
       v155 = v1.createStream(34962, v50.buffer);
      }
      else {
       v155 = v1.getBuffer(v50.buffer);
      }
      v162 = 'type' in v50 ? v43[v50.type] : v155.dtype;
      v157 = !!v50.normalized;
      v159 = v50.size | 0;
      v158 = v50.offset | 0;
      v161 = v50.stride | 0;
      v156 = v50.divisor | 0;
     }
    }
    v167 = bCoordFract.location;
    v168 = v0[v167];
    if (v160 === 1) {
     if (!v168.buffer) {
      v8.enableVertexAttribArray(v167);
     }
     v169 = v159 || 2;
     if (v168.type !== v162 || v168.size !== v169 || v168.buffer !== v155 || v168.normalized !== v157 || v168.offset !== v158 || v168.stride !== v161) {
      v8.bindBuffer(34962, v155.buffer);
      v8.vertexAttribPointer(v167, v169, v162, v157, v161, v158);
      v168.type = v162;
      v168.size = v169;
      v168.buffer = v155;
      v168.normalized = v157;
      v168.offset = v158;
      v168.stride = v161;
     }
     if (v168.divisor !== v156) {
      v101.vertexAttribDivisorANGLE(v167, v156);
      v168.divisor = v156;
     }
    }
    else {
     if (v168.buffer) {
      v8.disableVertexAttribArray(v167);
      v168.buffer = null;
     }
     if (v168.x !== v164 || v168.y !== v165 || v168.z !== v166 || v168.w !== v163) {
      v8.vertexAttrib4f(v167, v164, v165, v166, v163);
      v168.x = v164;
      v168.y = v165;
      v168.z = v166;
      v168.w = v163;
     }
    }
    v170 = a0['colorBuffer'];
    v51.buffer = v170;
    v171 = false;
    v172 = null;
    v173 = 0;
    v174 = false;
    v175 = 0;
    v176 = 0;
    v177 = 1;
    v178 = 0;
    v179 = 5126;
    v180 = 0;
    v181 = 0;
    v182 = 0;
    v183 = 0;
    if (v9(v51)) {
     v171 = true;
     v172 = v1.createStream(34962, v51);
     v179 = v172.dtype;
    }
    else {
     v172 = v1.getBuffer(v51);
     if (v172) {
      v179 = v172.dtype;
     }
     else if ('constant' in v51) {
      v177 = 2;
      if (typeof v51.constant === 'number') {
       v181 = v51.constant;
       v182 = v183 = v180 = 0;
      }
      else {
       v181 = v51.constant.length > 0 ? v51.constant[0] : 0;
       v182 = v51.constant.length > 1 ? v51.constant[1] : 0;
       v183 = v51.constant.length > 2 ? v51.constant[2] : 0;
       v180 = v51.constant.length > 3 ? v51.constant[3] : 0;
      }
     }
     else {
      if (v9(v51.buffer)) {
       v172 = v1.createStream(34962, v51.buffer);
      }
      else {
       v172 = v1.getBuffer(v51.buffer);
      }
      v179 = 'type' in v51 ? v43[v51.type] : v172.dtype;
      v174 = !!v51.normalized;
      v176 = v51.size | 0;
      v175 = v51.offset | 0;
      v178 = v51.stride | 0;
      v173 = v51.divisor | 0;
     }
    }
    v184 = color.location;
    v185 = v0[v184];
    if (v177 === 1) {
     if (!v185.buffer) {
      v8.enableVertexAttribArray(v184);
     }
     v186 = v176 || 4;
     if (v185.type !== v179 || v185.size !== v186 || v185.buffer !== v172 || v185.normalized !== v174 || v185.offset !== v175 || v185.stride !== v178) {
      v8.bindBuffer(34962, v172.buffer);
      v8.vertexAttribPointer(v184, v186, v179, v174, v178, v175);
      v185.type = v179;
      v185.size = v186;
      v185.buffer = v172;
      v185.normalized = v174;
      v185.offset = v175;
      v185.stride = v178;
     }
     if (v185.divisor !== v173) {
      v101.vertexAttribDivisorANGLE(v184, v173);
      v185.divisor = v173;
     }
    }
    else {
     if (v185.buffer) {
      v8.disableVertexAttribArray(v184);
      v185.buffer = null;
     }
     if (v185.x !== v181 || v185.y !== v182 || v185.z !== v183 || v185.w !== v180) {
      v8.vertexAttrib4f(v184, v181, v182, v183, v180);
      v185.x = v181;
      v185.y = v182;
      v185.z = v183;
      v185.w = v180;
     }
    }
    v187 = lineEnd.location;
    v188 = v0[v187];
    if (!v188.buffer) {
     v8.enableVertexAttribArray(v187);
    }
    if (v188.type !== 5126 || v188.size !== 1 || v188.buffer !== $4 || v188.normalized !== false || v188.offset !== 0 || v188.stride !== 8) {
     v8.bindBuffer(34962, $4.buffer);
     v8.vertexAttribPointer(v187, 1, 5126, false, 8, 0);
     v188.type = 5126;
     v188.size = 1;
     v188.buffer = $4;
     v188.normalized = false;
     v188.offset = 0;
     v188.stride = 8;
    }
    if (v188.divisor !== 0) {
     v101.vertexAttribDivisorANGLE(v187, 0);
     v188.divisor = 0;
    }
    v189 = lineTop.location;
    v190 = v0[v189];
    if (!v190.buffer) {
     v8.enableVertexAttribArray(v189);
    }
    if (v190.type !== 5126 || v190.size !== 1 || v190.buffer !== $5 || v190.normalized !== false || v190.offset !== 4 || v190.stride !== 8) {
     v8.bindBuffer(34962, $5.buffer);
     v8.vertexAttribPointer(v189, 1, 5126, false, 8, 4);
     v190.type = 5126;
     v190.size = 1;
     v190.buffer = $5;
     v190.normalized = false;
     v190.offset = 4;
     v190.stride = 8;
    }
    if (v190.divisor !== 0) {
     v101.vertexAttribDivisorANGLE(v189, 0);
     v190.divisor = 0;
    }
    v191 = a0['scale'];
    v192 = v191[0];
    v193 = v191[1];
    v8.uniform2f(scale.location, v192, v193);
    v194 = a0['scaleFract'];
    v195 = v194[0];
    v196 = v194[1];
    v8.uniform2f(scaleFract.location, v195, v196);
    v197 = a0['translate'];
    v198 = v197[0];
    v199 = v197[1];
    v8.uniform2f(translate.location, v198, v199);
    v200 = a0['translateFract'];
    v201 = v200[0];
    v202 = v200[1];
    v8.uniform2f(translateFract.location, v201, v202);
    v203 = a0['thickness'];
    v8.uniform1f(thickness.location, v203);
    v204 = a0['depth'];
    v8.uniform1f(depth.location, v204);
    v205 = $6.call(this, v2, a0, 0);
    v206 = v205[0];
    v207 = v205[1];
    v208 = v205[2];
    v209 = v205[3];
    v8.uniform4f(viewport.location, v206, v207, v208, v209);
    v210 = a0['dashLength'];
    v8.uniform1f(dashLength.location, v210);
    v211 = a0['opacity'];
    v8.uniform1f(opacity.location, v211);
    v212 = a0['dashTexture'];
    if (v212 && v212._reglType === 'framebuffer') {
     v212 = v212.color[0];
    }
    v213 = v212._texture;
    v8.uniform1i(dashTexture.location, v213.bind());
    v214 = v4.elements;
    if (v214) {
     v8.bindBuffer(34963, v214.buffer.buffer);
    }
    else if (v15.currentVAO) {
     v214 = v5.getElements(v15.currentVAO.elements);
     if (v214) v8.bindBuffer(34963, v214.buffer.buffer);
    }
    v215 = a0['count'];
    if (v215 > 0) {
     if (v214) {
      v101.drawElementsInstancedANGLE(5, 4, v214.type, 0 << ((v214.type - 5121) >> 1), v215);
     }
     else {
      v101.drawArraysInstancedANGLE(5, 0, 4, v215);
     }
    }
    else if (v215 < 0) {
     if (v214) {
      v8.drawElements(5, 4, v214.type, 0 << ((v214.type - 5121) >> 1));
     }
     else {
      v8.drawArrays(5, 0, 4);
     }
    }
    v3.dirty = true;
    v15.setVAO(null);
    v2.viewportWidth = v91;
    v2.viewportHeight = v92;
    if (v99) {
     $1.cpuTime += performance.now() - v100;
    }
    if (v103) {
     v1.destroyStream(v104);
    }
    if (v120) {
     v1.destroyStream(v121);
    }
    if (v137) {
     v1.destroyStream(v138);
    }
    if (v154) {
     v1.destroyStream(v155);
    }
    if (v171) {
     v1.destroyStream(v172);
    }
    v213.unbind();
   }
   , 'scope': function (a0, a1, a2) {
    var v216, v217, v218, v219, v220, v221, v222, v223, v224, v225, v226, v227, v228, v229, v230, v231, v232, v233, v234, v235, v236, v237, v238, v239, v240, v241, v242, v243, v244, v245, v246, v247, v248, v249, v250, v251, v252, v253, v254, v255, v256, v257, v258, v259, v260, v261, v262, v263, v264, v265, v266, v267, v268, v269, v270, v271, v272, v273, v274, v275, v276, v277, v278, v279, v280, v281, v282, v283, v284, v285, v286, v287, v288, v289, v290, v291, v292, v293, v294, v295, v296, v297, v298, v299, v300, v301, v302, v303, v304, v305, v306, v307, v308, v309, v310, v311, v312, v313, v314, v315, v316, v317, v318, v319, v320, v321, v322, v323, v324, v325, v326, v327, v328, v329, v330, v331, v332, v333, v334, v335, v336, v337, v338, v339, v340, v341, v342, v343, v344, v345, v346, v347, v348, v349, v350, v351, v352, v353, v354, v355, v356, v357, v358, v359, v360, v361, v362, v363, v364, v365, v366, v367, v368, v369, v370, v371, v372, v373, v374, v375, v376, v377, v378, v379, v380, v381, v382, v383, v384, v385, v386, v387, v388, v389, v390, v391, v392, v393, v394, v395, v396, v397, v398, v399, v400, v401, v402, v403, v404, v405, v406, v407, v408, v409, v410, v411, v412, v413, v414, v415, v416, v417, v418, v419, v420, v421, v422, v423, v424, v425, v426, v427, v428, v429, v430, v431, v432, v433, v434, v435, v436, v437, v438, v439, v440, v441;
    v216 = a0['viewport'];
    v217 = v216.x | 0;
    v218 = v216.y | 0;
    v219 = 'width' in v216 ? v216.width | 0 : (v2.framebufferWidth - v217);
    v220 = 'height' in v216 ? v216.height | 0 : (v2.framebufferHeight - v218);
    v221 = v2.viewportWidth;
    v2.viewportWidth = v219;
    v222 = v2.viewportHeight;
    v2.viewportHeight = v220;
    v223 = v38[0];
    v38[0] = v217;
    v224 = v38[1];
    v38[1] = v218;
    v225 = v38[2];
    v38[2] = v219;
    v226 = v38[3];
    v38[3] = v220;
    v227 = v16[0];
    v16[0] = 0;
    v228 = v16[1];
    v16[1] = 0;
    v229 = v16[2];
    v16[2] = 0;
    v230 = v16[3];
    v16[3] = 0;
    v231 = v10.blend_enable;
    v10.blend_enable = true;
    v232 = v18[0];
    v18[0] = 32774;
    v233 = v18[1];
    v18[1] = 32774;
    v234 = v20[0];
    v20[0] = 770;
    v235 = v20[1];
    v20[1] = 771;
    v236 = v20[2];
    v20[2] = 773;
    v237 = v20[3];
    v20[3] = 1;
    v238 = $7.call(this, v2, a0, a2);
    v239 = v10.depth_enable;
    v10.depth_enable = v238;
    v240 = a0['viewport'];
    v241 = v240.x | 0;
    v242 = v240.y | 0;
    v243 = 'width' in v240 ? v240.width | 0 : (v2.framebufferWidth - v241);
    v244 = 'height' in v240 ? v240.height | 0 : (v2.framebufferHeight - v242);
    v245 = v30[0];
    v30[0] = v241;
    v246 = v30[1];
    v30[1] = v242;
    v247 = v30[2];
    v30[2] = v243;
    v248 = v30[3];
    v30[3] = v244;
    v249 = v10.scissor_enable;
    v10.scissor_enable = true;
    v250 = v10.stencil_enable;
    v10.stencil_enable = false;
    v251 = v3.profile;
    if (v251) {
     v252 = performance.now();
     $1.count++;
    }
    v253 = v4.offset;
    v4.offset = 0;
    v254 = v4.count;
    v4.count = 4;
    v255 = a0['count'];
    v256 = v4.instances;
    v4.instances = v255;
    v257 = v4.primitive;
    v4.primitive = 5;
    v258 = a0['dashLength'];
    v259 = v14[23];
    v14[23] = v258;
    v260 = a0['dashTexture'];
    v261 = v14[24];
    v14[24] = v260;
    v262 = a0['depth'];
    v263 = v14[22];
    v14[22] = v262;
    v264 = a0['id'];
    v265 = v14[31];
    v14[31] = v264;
    v266 = a0['miterLimit'];
    v267 = v14[32];
    v14[32] = v266;
    v268 = $8.call(this, v2, a0, a2);
    v269 = v14[33];
    v14[33] = v268;
    v270 = a0['opacity'];
    v271 = v14[10];
    v14[10] = v270;
    v272 = v2['pixelRatio'];
    v273 = v14[34];
    v14[34] = v272;
    v274 = a0['scale'];
    v275 = v14[6];
    v14[6] = v274;
    v276 = a0['scaleFract'];
    v277 = v14[7];
    v14[7] = v276;
    v278 = a0['thickness'];
    v279 = v14[21];
    v14[21] = v278;
    v280 = a0['translate'];
    v281 = v14[8];
    v14[8] = v280;
    v282 = a0['translateFract'];
    v283 = v14[9];
    v14[9] = v282;
    v284 = $9.call(this, v2, a0, a2);
    v285 = v14[3];
    v14[3] = v284;
    v286 = a0['positionBuffer'];
    v47.buffer = v286;
    v287 = false;
    v288 = null;
    v289 = 0;
    v290 = false;
    v291 = 0;
    v292 = 0;
    v293 = 1;
    v294 = 0;
    v295 = 5126;
    v296 = 0;
    v297 = 0;
    v298 = 0;
    v299 = 0;
    if (v9(v47)) {
     v287 = true;
     v288 = v1.createStream(34962, v47);
     v295 = v288.dtype;
    }
    else {
     v288 = v1.getBuffer(v47);
     if (v288) {
      v295 = v288.dtype;
     }
     else if ('constant' in v47) {
      v293 = 2;
      if (typeof v47.constant === 'number') {
       v297 = v47.constant;
       v298 = v299 = v296 = 0;
      }
      else {
       v297 = v47.constant.length > 0 ? v47.constant[0] : 0;
       v298 = v47.constant.length > 1 ? v47.constant[1] : 0;
       v299 = v47.constant.length > 2 ? v47.constant[2] : 0;
       v296 = v47.constant.length > 3 ? v47.constant[3] : 0;
      }
     }
     else {
      if (v9(v47.buffer)) {
       v288 = v1.createStream(34962, v47.buffer);
      }
      else {
       v288 = v1.getBuffer(v47.buffer);
      }
      v295 = 'type' in v47 ? v43[v47.type] : v288.dtype;
      v290 = !!v47.normalized;
      v292 = v47.size | 0;
      v291 = v47.offset | 0;
      v294 = v47.stride | 0;
      v289 = v47.divisor | 0;
     }
    }
    v300 = $10.buffer;
    $10.buffer = v288;
    v301 = $10.divisor;
    $10.divisor = v289;
    v302 = $10.normalized;
    $10.normalized = v290;
    v303 = $10.offset;
    $10.offset = v291;
    v304 = $10.size;
    $10.size = v292;
    v305 = $10.state;
    $10.state = v293;
    v306 = $10.stride;
    $10.stride = v294;
    v307 = $10.type;
    $10.type = v295;
    v308 = $10.w;
    $10.w = v296;
    v309 = $10.x;
    $10.x = v297;
    v310 = $10.y;
    $10.y = v298;
    v311 = $10.z;
    $10.z = v299;
    v312 = a0['positionFractBuffer'];
    v48.buffer = v312;
    v313 = false;
    v314 = null;
    v315 = 0;
    v316 = false;
    v317 = 0;
    v318 = 0;
    v319 = 1;
    v320 = 0;
    v321 = 5126;
    v322 = 0;
    v323 = 0;
    v324 = 0;
    v325 = 0;
    if (v9(v48)) {
     v313 = true;
     v314 = v1.createStream(34962, v48);
     v321 = v314.dtype;
    }
    else {
     v314 = v1.getBuffer(v48);
     if (v314) {
      v321 = v314.dtype;
     }
     else if ('constant' in v48) {
      v319 = 2;
      if (typeof v48.constant === 'number') {
       v323 = v48.constant;
       v324 = v325 = v322 = 0;
      }
      else {
       v323 = v48.constant.length > 0 ? v48.constant[0] : 0;
       v324 = v48.constant.length > 1 ? v48.constant[1] : 0;
       v325 = v48.constant.length > 2 ? v48.constant[2] : 0;
       v322 = v48.constant.length > 3 ? v48.constant[3] : 0;
      }
     }
     else {
      if (v9(v48.buffer)) {
       v314 = v1.createStream(34962, v48.buffer);
      }
      else {
       v314 = v1.getBuffer(v48.buffer);
      }
      v321 = 'type' in v48 ? v43[v48.type] : v314.dtype;
      v316 = !!v48.normalized;
      v318 = v48.size | 0;
      v317 = v48.offset | 0;
      v320 = v48.stride | 0;
      v315 = v48.divisor | 0;
     }
    }
    v326 = $11.buffer;
    $11.buffer = v314;
    v327 = $11.divisor;
    $11.divisor = v315;
    v328 = $11.normalized;
    $11.normalized = v316;
    v329 = $11.offset;
    $11.offset = v317;
    v330 = $11.size;
    $11.size = v318;
    v331 = $11.state;
    $11.state = v319;
    v332 = $11.stride;
    $11.stride = v320;
    v333 = $11.type;
    $11.type = v321;
    v334 = $11.w;
    $11.w = v322;
    v335 = $11.x;
    $11.x = v323;
    v336 = $11.y;
    $11.y = v324;
    v337 = $11.z;
    $11.z = v325;
    v338 = a0['positionBuffer'];
    v49.buffer = v338;
    v339 = false;
    v340 = null;
    v341 = 0;
    v342 = false;
    v343 = 0;
    v344 = 0;
    v345 = 1;
    v346 = 0;
    v347 = 5126;
    v348 = 0;
    v349 = 0;
    v350 = 0;
    v351 = 0;
    if (v9(v49)) {
     v339 = true;
     v340 = v1.createStream(34962, v49);
     v347 = v340.dtype;
    }
    else {
     v340 = v1.getBuffer(v49);
     if (v340) {
      v347 = v340.dtype;
     }
     else if ('constant' in v49) {
      v345 = 2;
      if (typeof v49.constant === 'number') {
       v349 = v49.constant;
       v350 = v351 = v348 = 0;
      }
      else {
       v349 = v49.constant.length > 0 ? v49.constant[0] : 0;
       v350 = v49.constant.length > 1 ? v49.constant[1] : 0;
       v351 = v49.constant.length > 2 ? v49.constant[2] : 0;
       v348 = v49.constant.length > 3 ? v49.constant[3] : 0;
      }
     }
     else {
      if (v9(v49.buffer)) {
       v340 = v1.createStream(34962, v49.buffer);
      }
      else {
       v340 = v1.getBuffer(v49.buffer);
      }
      v347 = 'type' in v49 ? v43[v49.type] : v340.dtype;
      v342 = !!v49.normalized;
      v344 = v49.size | 0;
      v343 = v49.offset | 0;
      v346 = v49.stride | 0;
      v341 = v49.divisor | 0;
     }
    }
    v352 = $12.buffer;
    $12.buffer = v340;
    v353 = $12.divisor;
    $12.divisor = v341;
    v354 = $12.normalized;
    $12.normalized = v342;
    v355 = $12.offset;
    $12.offset = v343;
    v356 = $12.size;
    $12.size = v344;
    v357 = $12.state;
    $12.state = v345;
    v358 = $12.stride;
    $12.stride = v346;
    v359 = $12.type;
    $12.type = v347;
    v360 = $12.w;
    $12.w = v348;
    v361 = $12.x;
    $12.x = v349;
    v362 = $12.y;
    $12.y = v350;
    v363 = $12.z;
    $12.z = v351;
    v364 = a0['positionFractBuffer'];
    v50.buffer = v364;
    v365 = false;
    v366 = null;
    v367 = 0;
    v368 = false;
    v369 = 0;
    v370 = 0;
    v371 = 1;
    v372 = 0;
    v373 = 5126;
    v374 = 0;
    v375 = 0;
    v376 = 0;
    v377 = 0;
    if (v9(v50)) {
     v365 = true;
     v366 = v1.createStream(34962, v50);
     v373 = v366.dtype;
    }
    else {
     v366 = v1.getBuffer(v50);
     if (v366) {
      v373 = v366.dtype;
     }
     else if ('constant' in v50) {
      v371 = 2;
      if (typeof v50.constant === 'number') {
       v375 = v50.constant;
       v376 = v377 = v374 = 0;
      }
      else {
       v375 = v50.constant.length > 0 ? v50.constant[0] : 0;
       v376 = v50.constant.length > 1 ? v50.constant[1] : 0;
       v377 = v50.constant.length > 2 ? v50.constant[2] : 0;
       v374 = v50.constant.length > 3 ? v50.constant[3] : 0;
      }
     }
     else {
      if (v9(v50.buffer)) {
       v366 = v1.createStream(34962, v50.buffer);
      }
      else {
       v366 = v1.getBuffer(v50.buffer);
      }
      v373 = 'type' in v50 ? v43[v50.type] : v366.dtype;
      v368 = !!v50.normalized;
      v370 = v50.size | 0;
      v369 = v50.offset | 0;
      v372 = v50.stride | 0;
      v367 = v50.divisor | 0;
     }
    }
    v378 = $13.buffer;
    $13.buffer = v366;
    v379 = $13.divisor;
    $13.divisor = v367;
    v380 = $13.normalized;
    $13.normalized = v368;
    v381 = $13.offset;
    $13.offset = v369;
    v382 = $13.size;
    $13.size = v370;
    v383 = $13.state;
    $13.state = v371;
    v384 = $13.stride;
    $13.stride = v372;
    v385 = $13.type;
    $13.type = v373;
    v386 = $13.w;
    $13.w = v374;
    v387 = $13.x;
    $13.x = v375;
    v388 = $13.y;
    $13.y = v376;
    v389 = $13.z;
    $13.z = v377;
    v390 = a0['colorBuffer'];
    v51.buffer = v390;
    v391 = false;
    v392 = null;
    v393 = 0;
    v394 = false;
    v395 = 0;
    v396 = 0;
    v397 = 1;
    v398 = 0;
    v399 = 5126;
    v400 = 0;
    v401 = 0;
    v402 = 0;
    v403 = 0;
    if (v9(v51)) {
     v391 = true;
     v392 = v1.createStream(34962, v51);
     v399 = v392.dtype;
    }
    else {
     v392 = v1.getBuffer(v51);
     if (v392) {
      v399 = v392.dtype;
     }
     else if ('constant' in v51) {
      v397 = 2;
      if (typeof v51.constant === 'number') {
       v401 = v51.constant;
       v402 = v403 = v400 = 0;
      }
      else {
       v401 = v51.constant.length > 0 ? v51.constant[0] : 0;
       v402 = v51.constant.length > 1 ? v51.constant[1] : 0;
       v403 = v51.constant.length > 2 ? v51.constant[2] : 0;
       v400 = v51.constant.length > 3 ? v51.constant[3] : 0;
      }
     }
     else {
      if (v9(v51.buffer)) {
       v392 = v1.createStream(34962, v51.buffer);
      }
      else {
       v392 = v1.getBuffer(v51.buffer);
      }
      v399 = 'type' in v51 ? v43[v51.type] : v392.dtype;
      v394 = !!v51.normalized;
      v396 = v51.size | 0;
      v395 = v51.offset | 0;
      v398 = v51.stride | 0;
      v393 = v51.divisor | 0;
     }
    }
    v404 = $14.buffer;
    $14.buffer = v392;
    v405 = $14.divisor;
    $14.divisor = v393;
    v406 = $14.normalized;
    $14.normalized = v394;
    v407 = $14.offset;
    $14.offset = v395;
    v408 = $14.size;
    $14.size = v396;
    v409 = $14.state;
    $14.state = v397;
    v410 = $14.stride;
    $14.stride = v398;
    v411 = $14.type;
    $14.type = v399;
    v412 = $14.w;
    $14.w = v400;
    v413 = $14.x;
    $14.x = v401;
    v414 = $14.y;
    $14.y = v402;
    v415 = $14.z;
    $14.z = v403;
    v416 = $15.buffer;
    $15.buffer = $4;
    v417 = $15.divisor;
    $15.divisor = 0;
    v418 = $15.normalized;
    $15.normalized = false;
    v419 = $15.offset;
    $15.offset = 0;
    v420 = $15.size;
    $15.size = 0;
    v421 = $15.state;
    $15.state = 1;
    v422 = $15.stride;
    $15.stride = 8;
    v423 = $15.type;
    $15.type = 5126;
    v424 = $15.w;
    $15.w = 0;
    v425 = $15.x;
    $15.x = 0;
    v426 = $15.y;
    $15.y = 0;
    v427 = $15.z;
    $15.z = 0;
    v428 = $16.buffer;
    $16.buffer = $5;
    v429 = $16.divisor;
    $16.divisor = 0;
    v430 = $16.normalized;
    $16.normalized = false;
    v431 = $16.offset;
    $16.offset = 4;
    v432 = $16.size;
    $16.size = 0;
    v433 = $16.state;
    $16.state = 1;
    v434 = $16.stride;
    $16.stride = 8;
    v435 = $16.type;
    $16.type = 5126;
    v436 = $16.w;
    $16.w = 0;
    v437 = $16.x;
    $16.x = 0;
    v438 = $16.y;
    $16.y = 0;
    v439 = $16.z;
    $16.z = 0;
    v440 = v11.vert;
    v11.vert = 20;
    v441 = v11.frag;
    v11.frag = 19;
    v3.dirty = true;
    a1(v2, a0, a2);
    v2.viewportWidth = v221;
    v2.viewportHeight = v222;
    v38[0] = v223;
    v38[1] = v224;
    v38[2] = v225;
    v38[3] = v226;
    v16[0] = v227;
    v16[1] = v228;
    v16[2] = v229;
    v16[3] = v230;
    v10.blend_enable = v231;
    v18[0] = v232;
    v18[1] = v233;
    v20[0] = v234;
    v20[1] = v235;
    v20[2] = v236;
    v20[3] = v237;
    v10.depth_enable = v239;
    v30[0] = v245;
    v30[1] = v246;
    v30[2] = v247;
    v30[3] = v248;
    v10.scissor_enable = v249;
    v10.stencil_enable = v250;
    if (v251) {
     $1.cpuTime += performance.now() - v252;
    }
    v4.offset = v253;
    v4.count = v254;
    v4.instances = v256;
    v4.primitive = v257;
    v14[23] = v259;
    v14[24] = v261;
    v14[22] = v263;
    v14[31] = v265;
    v14[32] = v267;
    v14[33] = v269;
    v14[10] = v271;
    v14[34] = v273;
    v14[6] = v275;
    v14[7] = v277;
    v14[21] = v279;
    v14[8] = v281;
    v14[9] = v283;
    v14[3] = v285;
    if (v287) {
     v1.destroyStream(v288);
    }
    $10.buffer = v300;
    $10.divisor = v301;
    $10.normalized = v302;
    $10.offset = v303;
    $10.size = v304;
    $10.state = v305;
    $10.stride = v306;
    $10.type = v307;
    $10.w = v308;
    $10.x = v309;
    $10.y = v310;
    $10.z = v311;
    if (v313) {
     v1.destroyStream(v314);
    }
    $11.buffer = v326;
    $11.divisor = v327;
    $11.normalized = v328;
    $11.offset = v329;
    $11.size = v330;
    $11.state = v331;
    $11.stride = v332;
    $11.type = v333;
    $11.w = v334;
    $11.x = v335;
    $11.y = v336;
    $11.z = v337;
    if (v339) {
     v1.destroyStream(v340);
    }
    $12.buffer = v352;
    $12.divisor = v353;
    $12.normalized = v354;
    $12.offset = v355;
    $12.size = v356;
    $12.state = v357;
    $12.stride = v358;
    $12.type = v359;
    $12.w = v360;
    $12.x = v361;
    $12.y = v362;
    $12.z = v363;
    if (v365) {
     v1.destroyStream(v366);
    }
    $13.buffer = v378;
    $13.divisor = v379;
    $13.normalized = v380;
    $13.offset = v381;
    $13.size = v382;
    $13.state = v383;
    $13.stride = v384;
    $13.type = v385;
    $13.w = v386;
    $13.x = v387;
    $13.y = v388;
    $13.z = v389;
    if (v391) {
     v1.destroyStream(v392);
    }
    $14.buffer = v404;
    $14.divisor = v405;
    $14.normalized = v406;
    $14.offset = v407;
    $14.size = v408;
    $14.state = v409;
    $14.stride = v410;
    $14.type = v411;
    $14.w = v412;
    $14.x = v413;
    $14.y = v414;
    $14.z = v415;
    $15.buffer = v416;
    $15.divisor = v417;
    $15.normalized = v418;
    $15.offset = v419;
    $15.size = v420;
    $15.state = v421;
    $15.stride = v422;
    $15.type = v423;
    $15.w = v424;
    $15.x = v425;
    $15.y = v426;
    $15.z = v427;
    $16.buffer = v428;
    $16.divisor = v429;
    $16.normalized = v430;
    $16.offset = v431;
    $16.size = v432;
    $16.state = v433;
    $16.stride = v434;
    $16.type = v435;
    $16.w = v436;
    $16.x = v437;
    $16.y = v438;
    $16.z = v439;
    v11.vert = v440;
    v11.frag = v441;
    v3.dirty = true;
   }
   ,
  }

 },
 '$22,aColor,aCoord,bColor,bCoord,dashLength,dashTexture,depth,lineEnd,lineTop,miterLimit,miterMode,nextCoord,opacity,prevCoord,scale,thickness,translate,viewport': function ($0, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, aColor, aCoord, bColor, bCoord, dashLength, dashTexture, depth, lineEnd, lineTop, miterLimit, miterMode, nextCoord, opacity, prevCoord, scale, thickness, translate, viewport
 ) {
  'use strict';
  var v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15, v16, v17, v18, v19, v20, v21, v22, v23, v24, v25, v26, v27, v28, v29, v30, v31, v32, v33, v34, v35, v36, v37, v38, v39, v40, v41, v42, v43, v44, v45, v46, v47, v48, v49, v50, v51, v52;
  v0 = $0.attributes;
  v1 = $0.buffer;
  v2 = $0.context;
  v3 = $0.current;
  v4 = $0.draw;
  v5 = $0.elements;
  v6 = $0.extensions;
  v7 = $0.framebuffer;
  v8 = $0.gl;
  v9 = $0.isBufferArgs;
  v10 = $0.next;
  v11 = $0.shader;
  v12 = $0.strings;
  v13 = $0.timer;
  v14 = $0.uniforms;
  v15 = $0.vao;
  v16 = v10.blend_color;
  v17 = v3.blend_color;
  v18 = v10.blend_equation;
  v19 = v3.blend_equation;
  v20 = v10.blend_func;
  v21 = v3.blend_func;
  v22 = v10.colorMask;
  v23 = v3.colorMask;
  v24 = v10.depth_range;
  v25 = v3.depth_range;
  v26 = v10.polygonOffset_offset;
  v27 = v3.polygonOffset_offset;
  v28 = v10.sample_coverage;
  v29 = v3.sample_coverage;
  v30 = v10.scissor_box;
  v31 = v3.scissor_box;
  v32 = v10.stencil_func;
  v33 = v3.stencil_func;
  v34 = v10.stencil_opBack;
  v35 = v3.stencil_opBack;
  v36 = v10.stencil_opFront;
  v37 = v3.stencil_opFront;
  v38 = v10.viewport;
  v39 = v3.viewport;
  v40 = {
   'add': 32774, 'subtract': 32778, 'reverse subtract': 32779
  }
   ;
  v41 = {
   '0': 0, '1': 1, 'zero': 0, 'one': 1, 'src color': 768, 'one minus src color': 769, 'src alpha': 770, 'one minus src alpha': 771, 'dst color': 774, 'one minus dst color': 775, 'dst alpha': 772, 'one minus dst alpha': 773, 'constant color': 32769, 'one minus constant color': 32770, 'constant alpha': 32771, 'one minus constant alpha': 32772, 'src alpha saturate': 776
  }
   ;
  v42 = {
   'never': 512, 'less': 513, '<': 513, 'equal': 514, '=': 514, '==': 514, '===': 514, 'lequal': 515, '<=': 515, 'greater': 516, '>': 516, 'notequal': 517, '!=': 517, '!==': 517, 'gequal': 518, '>=': 518, 'always': 519
  }
   ;
  v43 = {
   'int8': 5120, 'int16': 5122, 'int32': 5124, 'uint8': 5121, 'uint16': 5123, 'uint32': 5125, 'float': 5126, 'float32': 5126
  }
   ;
  v44 = {
   'cw': 2304, 'ccw': 2305
  }
   ;
  v45 = {
   'points': 0, 'point': 0, 'lines': 1, 'line': 1, 'triangles': 4, 'triangle': 4, 'line loop': 2, 'line strip': 3, 'triangle strip': 5, 'triangle fan': 6
  }
   ;
  v46 = {
   '0': 0, 'zero': 0, 'keep': 7680, 'replace': 7681, 'increment': 7682, 'decrement': 7683, 'increment wrap': 34055, 'decrement wrap': 34056, 'invert': 5386
  }
   ;
  v47 = {
  }
   ;
  v47.divisor = 1;
  v47.offset = 0;
  v47.stride = 4;
  v48 = {
  }
   ;
  v48.divisor = 1;
  v48.offset = 8;
  v48.stride = 8;
  v49 = {
  }
   ;
  v49.divisor = 1;
  v49.offset = 4;
  v49.stride = 4;
  v50 = {
  }
   ;
  v50.divisor = 1;
  v50.offset = 16;
  v50.stride = 8;
  v51 = {
  }
   ;
  v51.divisor = 1;
  v51.offset = 24;
  v51.stride = 8;
  v52 = {
  }
   ;
  v52.divisor = 1;
  v52.offset = 0;
  v52.stride = 8;
  return {
   'batch': function (a0, a1) {
    var v482, v483, v514, v515, v516, v517, v518;
    v482 = v6.angle_instanced_arrays;
    v483 = v7.next;
    if (v483 !== v7.cur) {
     if (v483) {
      v8.bindFramebuffer(36160, v483.framebuffer);
     }
     else {
      v8.bindFramebuffer(36160, null);
     }
     v7.cur = v483;
    }
    if (v3.dirty) {
     var v484, v485, v486, v487, v488, v489, v490, v491, v492, v493, v494, v495, v496, v497, v498, v499, v500, v501, v502, v503, v504, v505, v506, v507, v508, v509, v510, v511, v512, v513;
     v484 = v10.dither;
     if (v484 !== v3.dither) {
      if (v484) {
       v8.enable(3024);
      }
      else {
       v8.disable(3024);
      }
      v3.dither = v484;
     }
     v485 = v10.depth_func;
     if (v485 !== v3.depth_func) {
      v8.depthFunc(v485);
      v3.depth_func = v485;
     }
     v486 = v24[0];
     v487 = v24[1];
     if (v486 !== v25[0] || v487 !== v25[1]) {
      v8.depthRange(v486, v487);
      v25[0] = v486;
      v25[1] = v487;
     }
     v488 = v10.depth_mask;
     if (v488 !== v3.depth_mask) {
      v8.depthMask(v488);
      v3.depth_mask = v488;
     }
     v489 = v22[0];
     v490 = v22[1];
     v491 = v22[2];
     v492 = v22[3];
     if (v489 !== v23[0] || v490 !== v23[1] || v491 !== v23[2] || v492 !== v23[3]) {
      v8.colorMask(v489, v490, v491, v492);
      v23[0] = v489;
      v23[1] = v490;
      v23[2] = v491;
      v23[3] = v492;
     }
     v493 = v10.frontFace;
     if (v493 !== v3.frontFace) {
      v8.frontFace(v493);
      v3.frontFace = v493;
     }
     v494 = v10.lineWidth;
     if (v494 !== v3.lineWidth) {
      v8.lineWidth(v494);
      v3.lineWidth = v494;
     }
     v495 = v10.polygonOffset_enable;
     if (v495 !== v3.polygonOffset_enable) {
      if (v495) {
       v8.enable(32823);
      }
      else {
       v8.disable(32823);
      }
      v3.polygonOffset_enable = v495;
     }
     v496 = v26[0];
     v497 = v26[1];
     if (v496 !== v27[0] || v497 !== v27[1]) {
      v8.polygonOffset(v496, v497);
      v27[0] = v496;
      v27[1] = v497;
     }
     v498 = v10.sample_alpha;
     if (v498 !== v3.sample_alpha) {
      if (v498) {
       v8.enable(32926);
      }
      else {
       v8.disable(32926);
      }
      v3.sample_alpha = v498;
     }
     v499 = v10.sample_enable;
     if (v499 !== v3.sample_enable) {
      if (v499) {
       v8.enable(32928);
      }
      else {
       v8.disable(32928);
      }
      v3.sample_enable = v499;
     }
     v500 = v28[0];
     v501 = v28[1];
     if (v500 !== v29[0] || v501 !== v29[1]) {
      v8.sampleCoverage(v500, v501);
      v29[0] = v500;
      v29[1] = v501;
     }
     v502 = v10.stencil_mask;
     if (v502 !== v3.stencil_mask) {
      v8.stencilMask(v502);
      v3.stencil_mask = v502;
     }
     v503 = v32[0];
     v504 = v32[1];
     v505 = v32[2];
     if (v503 !== v33[0] || v504 !== v33[1] || v505 !== v33[2]) {
      v8.stencilFunc(v503, v504, v505);
      v33[0] = v503;
      v33[1] = v504;
      v33[2] = v505;
     }
     v506 = v36[0];
     v507 = v36[1];
     v508 = v36[2];
     v509 = v36[3];
     if (v506 !== v37[0] || v507 !== v37[1] || v508 !== v37[2] || v509 !== v37[3]) {
      v8.stencilOpSeparate(v506, v507, v508, v509);
      v37[0] = v506;
      v37[1] = v507;
      v37[2] = v508;
      v37[3] = v509;
     }
     v510 = v34[0];
     v511 = v34[1];
     v512 = v34[2];
     v513 = v34[3];
     if (v510 !== v35[0] || v511 !== v35[1] || v512 !== v35[2] || v513 !== v35[3]) {
      v8.stencilOpSeparate(v510, v511, v512, v513);
      v35[0] = v510;
      v35[1] = v511;
      v35[2] = v512;
      v35[3] = v513;
     }
    }
    v8.blendColor(0, 0, 0, 0);
    v17[0] = 0;
    v17[1] = 0;
    v17[2] = 0;
    v17[3] = 0;
    v8.enable(3042);
    v3.blend_enable = true;
    v8.blendEquationSeparate(32774, 32774);
    v19[0] = 32774;
    v19[1] = 32774;
    v8.blendFuncSeparate(770, 771, 773, 1);
    v21[0] = 770;
    v21[1] = 771;
    v21[2] = 773;
    v21[3] = 1;
    v8.enable(2884);
    v3.cull_enable = true;
    v8.cullFace(1029);
    v3.cull_face = 1029;
    v8.enable(3089);
    v3.scissor_enable = true;
    v8.disable(2960);
    v3.stencil_enable = false;
    v514 = v3.profile;
    if (v514) {
     v515 = performance.now();
     $1.count += a1;
    }
    v8.useProgram($19.program);
    v516 = v6.angle_instanced_arrays;
    var v532, v533, v534, v535, v671;
    v15.setVAO(null);
    v532 = lineEnd.location;
    v533 = v0[v532];
    if (!v533.buffer) {
     v8.enableVertexAttribArray(v532);
    }
    if (v533.type !== 5126 || v533.size !== 1 || v533.buffer !== $4 || v533.normalized !== false || v533.offset !== 0 || v533.stride !== 8) {
     v8.bindBuffer(34962, $4.buffer);
     v8.vertexAttribPointer(v532, 1, 5126, false, 8, 0);
     v533.type = 5126;
     v533.size = 1;
     v533.buffer = $4;
     v533.normalized = false;
     v533.offset = 0;
     v533.stride = 8;
    }
    if (v533.divisor !== 0) {
     v516.vertexAttribDivisorANGLE(v532, 0);
     v533.divisor = 0;
    }
    v534 = lineTop.location;
    v535 = v0[v534];
    if (!v535.buffer) {
     v8.enableVertexAttribArray(v534);
    }
    if (v535.type !== 5126 || v535.size !== 1 || v535.buffer !== $5 || v535.normalized !== false || v535.offset !== 4 || v535.stride !== 8) {
     v8.bindBuffer(34962, $5.buffer);
     v8.vertexAttribPointer(v534, 1, 5126, false, 8, 4);
     v535.type = 5126;
     v535.size = 1;
     v535.buffer = $5;
     v535.normalized = false;
     v535.offset = 4;
     v535.stride = 8;
    }
    if (v535.divisor !== 0) {
     v516.vertexAttribDivisorANGLE(v534, 0);
     v535.divisor = 0;
    }
    v671 = v4.elements;
    if (v671) {
     v8.bindBuffer(34963, v671.buffer.buffer);
    }
    else if (v15.currentVAO) {
     v671 = v5.getElements(v15.currentVAO.elements);
     if (v671) v8.bindBuffer(34963, v671.buffer.buffer);
    }
    for (v517 = 0;
     v517 < a1;
     ++v517) {
     v518 = a0[v517];
     var v519, v520, v521, v522, v523, v524, v525, v526, v527, v528, v529, v530, v531, v536, v537, v538, v539, v540, v541, v542, v543, v544, v545, v546, v547, v548, v549, v550, v551, v552, v553, v554, v555, v556, v557, v558, v559, v560, v561, v562, v563, v564, v565, v566, v567, v568, v569, v570, v571, v572, v573, v574, v575, v576, v577, v578, v579, v580, v581, v582, v583, v584, v585, v586, v587, v588, v589, v590, v591, v592, v593, v594, v595, v596, v597, v598, v599, v600, v601, v602, v603, v604, v605, v606, v607, v608, v609, v610, v611, v612, v613, v614, v615, v616, v617, v618, v619, v620, v621, v622, v623, v624, v625, v626, v627, v628, v629, v630, v631, v632, v633, v634, v635, v636, v637, v638, v639, v640, v641, v642, v643, v644, v645, v646, v647, v648, v649, v650, v651, v652, v653, v654, v655, v656, v657, v658, v659, v660, v661, v662, v663, v664, v665, v666, v667, v668, v669, v670, v672;
     v519 = v518['viewport'];
     v520 = v519.x | 0;
     v521 = v519.y | 0;
     v522 = 'width' in v519 ? v519.width | 0 : (v2.framebufferWidth - v520);
     v523 = 'height' in v519 ? v519.height | 0 : (v2.framebufferHeight - v521);
     v524 = v2.viewportWidth;
     v2.viewportWidth = v522;
     v525 = v2.viewportHeight;
     v2.viewportHeight = v523;
     v8.viewport(v520, v521, v522, v523);
     v39[0] = v520;
     v39[1] = v521;
     v39[2] = v522;
     v39[3] = v523;
     v526 = $20.call(this, v2, v518, v517);
     if (v526) {
      v8.enable(2929);
     }
     else {
      v8.disable(2929);
     }
     v3.depth_enable = v526;
     v527 = v518['viewport'];
     v528 = v527.x | 0;
     v529 = v527.y | 0;
     v530 = 'width' in v527 ? v527.width | 0 : (v2.framebufferWidth - v528);
     v531 = 'height' in v527 ? v527.height | 0 : (v2.framebufferHeight - v529);
     v8.scissor(v528, v529, v530, v531);
     v31[0] = v528;
     v31[1] = v529;
     v31[2] = v530;
     v31[3] = v531;
     v536 = v518['positionBuffer'];
     v48.buffer = v536;
     v537 = false;
     v538 = null;
     v539 = 0;
     v540 = false;
     v541 = 0;
     v542 = 0;
     v543 = 1;
     v544 = 0;
     v545 = 5126;
     v546 = 0;
     v547 = 0;
     v548 = 0;
     v549 = 0;
     if (v9(v48)) {
      v537 = true;
      v538 = v1.createStream(34962, v48);
      v545 = v538.dtype;
     }
     else {
      v538 = v1.getBuffer(v48);
      if (v538) {
       v545 = v538.dtype;
      }
      else if ('constant' in v48) {
       v543 = 2;
       if (typeof v48.constant === 'number') {
        v547 = v48.constant;
        v548 = v549 = v546 = 0;
       }
       else {
        v547 = v48.constant.length > 0 ? v48.constant[0] : 0;
        v548 = v48.constant.length > 1 ? v48.constant[1] : 0;
        v549 = v48.constant.length > 2 ? v48.constant[2] : 0;
        v546 = v48.constant.length > 3 ? v48.constant[3] : 0;
       }
      }
      else {
       if (v9(v48.buffer)) {
        v538 = v1.createStream(34962, v48.buffer);
       }
       else {
        v538 = v1.getBuffer(v48.buffer);
       }
       v545 = 'type' in v48 ? v43[v48.type] : v538.dtype;
       v540 = !!v48.normalized;
       v542 = v48.size | 0;
       v541 = v48.offset | 0;
       v544 = v48.stride | 0;
       v539 = v48.divisor | 0;
      }
     }
     v550 = aCoord.location;
     v551 = v0[v550];
     if (v543 === 1) {
      if (!v551.buffer) {
       v8.enableVertexAttribArray(v550);
      }
      v552 = v542 || 2;
      if (v551.type !== v545 || v551.size !== v552 || v551.buffer !== v538 || v551.normalized !== v540 || v551.offset !== v541 || v551.stride !== v544) {
       v8.bindBuffer(34962, v538.buffer);
       v8.vertexAttribPointer(v550, v552, v545, v540, v544, v541);
       v551.type = v545;
       v551.size = v552;
       v551.buffer = v538;
       v551.normalized = v540;
       v551.offset = v541;
       v551.stride = v544;
      }
      if (v551.divisor !== v539) {
       v516.vertexAttribDivisorANGLE(v550, v539);
       v551.divisor = v539;
      }
     }
     else {
      if (v551.buffer) {
       v8.disableVertexAttribArray(v550);
       v551.buffer = null;
      }
      if (v551.x !== v547 || v551.y !== v548 || v551.z !== v549 || v551.w !== v546) {
       v8.vertexAttrib4f(v550, v547, v548, v549, v546);
       v551.x = v547;
       v551.y = v548;
       v551.z = v549;
       v551.w = v546;
      }
     }
     v553 = v518['positionBuffer'];
     v50.buffer = v553;
     v554 = false;
     v555 = null;
     v556 = 0;
     v557 = false;
     v558 = 0;
     v559 = 0;
     v560 = 1;
     v561 = 0;
     v562 = 5126;
     v563 = 0;
     v564 = 0;
     v565 = 0;
     v566 = 0;
     if (v9(v50)) {
      v554 = true;
      v555 = v1.createStream(34962, v50);
      v562 = v555.dtype;
     }
     else {
      v555 = v1.getBuffer(v50);
      if (v555) {
       v562 = v555.dtype;
      }
      else if ('constant' in v50) {
       v560 = 2;
       if (typeof v50.constant === 'number') {
        v564 = v50.constant;
        v565 = v566 = v563 = 0;
       }
       else {
        v564 = v50.constant.length > 0 ? v50.constant[0] : 0;
        v565 = v50.constant.length > 1 ? v50.constant[1] : 0;
        v566 = v50.constant.length > 2 ? v50.constant[2] : 0;
        v563 = v50.constant.length > 3 ? v50.constant[3] : 0;
       }
      }
      else {
       if (v9(v50.buffer)) {
        v555 = v1.createStream(34962, v50.buffer);
       }
       else {
        v555 = v1.getBuffer(v50.buffer);
       }
       v562 = 'type' in v50 ? v43[v50.type] : v555.dtype;
       v557 = !!v50.normalized;
       v559 = v50.size | 0;
       v558 = v50.offset | 0;
       v561 = v50.stride | 0;
       v556 = v50.divisor | 0;
      }
     }
     v567 = bCoord.location;
     v568 = v0[v567];
     if (v560 === 1) {
      if (!v568.buffer) {
       v8.enableVertexAttribArray(v567);
      }
      v569 = v559 || 2;
      if (v568.type !== v562 || v568.size !== v569 || v568.buffer !== v555 || v568.normalized !== v557 || v568.offset !== v558 || v568.stride !== v561) {
       v8.bindBuffer(34962, v555.buffer);
       v8.vertexAttribPointer(v567, v569, v562, v557, v561, v558);
       v568.type = v562;
       v568.size = v569;
       v568.buffer = v555;
       v568.normalized = v557;
       v568.offset = v558;
       v568.stride = v561;
      }
      if (v568.divisor !== v556) {
       v516.vertexAttribDivisorANGLE(v567, v556);
       v568.divisor = v556;
      }
     }
     else {
      if (v568.buffer) {
       v8.disableVertexAttribArray(v567);
       v568.buffer = null;
      }
      if (v568.x !== v564 || v568.y !== v565 || v568.z !== v566 || v568.w !== v563) {
       v8.vertexAttrib4f(v567, v564, v565, v566, v563);
       v568.x = v564;
       v568.y = v565;
       v568.z = v566;
       v568.w = v563;
      }
     }
     v570 = v518['positionBuffer'];
     v51.buffer = v570;
     v571 = false;
     v572 = null;
     v573 = 0;
     v574 = false;
     v575 = 0;
     v576 = 0;
     v577 = 1;
     v578 = 0;
     v579 = 5126;
     v580 = 0;
     v581 = 0;
     v582 = 0;
     v583 = 0;
     if (v9(v51)) {
      v571 = true;
      v572 = v1.createStream(34962, v51);
      v579 = v572.dtype;
     }
     else {
      v572 = v1.getBuffer(v51);
      if (v572) {
       v579 = v572.dtype;
      }
      else if ('constant' in v51) {
       v577 = 2;
       if (typeof v51.constant === 'number') {
        v581 = v51.constant;
        v582 = v583 = v580 = 0;
       }
       else {
        v581 = v51.constant.length > 0 ? v51.constant[0] : 0;
        v582 = v51.constant.length > 1 ? v51.constant[1] : 0;
        v583 = v51.constant.length > 2 ? v51.constant[2] : 0;
        v580 = v51.constant.length > 3 ? v51.constant[3] : 0;
       }
      }
      else {
       if (v9(v51.buffer)) {
        v572 = v1.createStream(34962, v51.buffer);
       }
       else {
        v572 = v1.getBuffer(v51.buffer);
       }
       v579 = 'type' in v51 ? v43[v51.type] : v572.dtype;
       v574 = !!v51.normalized;
       v576 = v51.size | 0;
       v575 = v51.offset | 0;
       v578 = v51.stride | 0;
       v573 = v51.divisor | 0;
      }
     }
     v584 = nextCoord.location;
     v585 = v0[v584];
     if (v577 === 1) {
      if (!v585.buffer) {
       v8.enableVertexAttribArray(v584);
      }
      v586 = v576 || 2;
      if (v585.type !== v579 || v585.size !== v586 || v585.buffer !== v572 || v585.normalized !== v574 || v585.offset !== v575 || v585.stride !== v578) {
       v8.bindBuffer(34962, v572.buffer);
       v8.vertexAttribPointer(v584, v586, v579, v574, v578, v575);
       v585.type = v579;
       v585.size = v586;
       v585.buffer = v572;
       v585.normalized = v574;
       v585.offset = v575;
       v585.stride = v578;
      }
      if (v585.divisor !== v573) {
       v516.vertexAttribDivisorANGLE(v584, v573);
       v585.divisor = v573;
      }
     }
     else {
      if (v585.buffer) {
       v8.disableVertexAttribArray(v584);
       v585.buffer = null;
      }
      if (v585.x !== v581 || v585.y !== v582 || v585.z !== v583 || v585.w !== v580) {
       v8.vertexAttrib4f(v584, v581, v582, v583, v580);
       v585.x = v581;
       v585.y = v582;
       v585.z = v583;
       v585.w = v580;
      }
     }
     v587 = v518['positionBuffer'];
     v52.buffer = v587;
     v588 = false;
     v589 = null;
     v590 = 0;
     v591 = false;
     v592 = 0;
     v593 = 0;
     v594 = 1;
     v595 = 0;
     v596 = 5126;
     v597 = 0;
     v598 = 0;
     v599 = 0;
     v600 = 0;
     if (v9(v52)) {
      v588 = true;
      v589 = v1.createStream(34962, v52);
      v596 = v589.dtype;
     }
     else {
      v589 = v1.getBuffer(v52);
      if (v589) {
       v596 = v589.dtype;
      }
      else if ('constant' in v52) {
       v594 = 2;
       if (typeof v52.constant === 'number') {
        v598 = v52.constant;
        v599 = v600 = v597 = 0;
       }
       else {
        v598 = v52.constant.length > 0 ? v52.constant[0] : 0;
        v599 = v52.constant.length > 1 ? v52.constant[1] : 0;
        v600 = v52.constant.length > 2 ? v52.constant[2] : 0;
        v597 = v52.constant.length > 3 ? v52.constant[3] : 0;
       }
      }
      else {
       if (v9(v52.buffer)) {
        v589 = v1.createStream(34962, v52.buffer);
       }
       else {
        v589 = v1.getBuffer(v52.buffer);
       }
       v596 = 'type' in v52 ? v43[v52.type] : v589.dtype;
       v591 = !!v52.normalized;
       v593 = v52.size | 0;
       v592 = v52.offset | 0;
       v595 = v52.stride | 0;
       v590 = v52.divisor | 0;
      }
     }
     v601 = prevCoord.location;
     v602 = v0[v601];
     if (v594 === 1) {
      if (!v602.buffer) {
       v8.enableVertexAttribArray(v601);
      }
      v603 = v593 || 2;
      if (v602.type !== v596 || v602.size !== v603 || v602.buffer !== v589 || v602.normalized !== v591 || v602.offset !== v592 || v602.stride !== v595) {
       v8.bindBuffer(34962, v589.buffer);
       v8.vertexAttribPointer(v601, v603, v596, v591, v595, v592);
       v602.type = v596;
       v602.size = v603;
       v602.buffer = v589;
       v602.normalized = v591;
       v602.offset = v592;
       v602.stride = v595;
      }
      if (v602.divisor !== v590) {
       v516.vertexAttribDivisorANGLE(v601, v590);
       v602.divisor = v590;
      }
     }
     else {
      if (v602.buffer) {
       v8.disableVertexAttribArray(v601);
       v602.buffer = null;
      }
      if (v602.x !== v598 || v602.y !== v599 || v602.z !== v600 || v602.w !== v597) {
       v8.vertexAttrib4f(v601, v598, v599, v600, v597);
       v602.x = v598;
       v602.y = v599;
       v602.z = v600;
       v602.w = v597;
      }
     }
     v604 = v518['colorBuffer'];
     v47.buffer = v604;
     v605 = false;
     v606 = null;
     v607 = 0;
     v608 = false;
     v609 = 0;
     v610 = 0;
     v611 = 1;
     v612 = 0;
     v613 = 5126;
     v614 = 0;
     v615 = 0;
     v616 = 0;
     v617 = 0;
     if (v9(v47)) {
      v605 = true;
      v606 = v1.createStream(34962, v47);
      v613 = v606.dtype;
     }
     else {
      v606 = v1.getBuffer(v47);
      if (v606) {
       v613 = v606.dtype;
      }
      else if ('constant' in v47) {
       v611 = 2;
       if (typeof v47.constant === 'number') {
        v615 = v47.constant;
        v616 = v617 = v614 = 0;
       }
       else {
        v615 = v47.constant.length > 0 ? v47.constant[0] : 0;
        v616 = v47.constant.length > 1 ? v47.constant[1] : 0;
        v617 = v47.constant.length > 2 ? v47.constant[2] : 0;
        v614 = v47.constant.length > 3 ? v47.constant[3] : 0;
       }
      }
      else {
       if (v9(v47.buffer)) {
        v606 = v1.createStream(34962, v47.buffer);
       }
       else {
        v606 = v1.getBuffer(v47.buffer);
       }
       v613 = 'type' in v47 ? v43[v47.type] : v606.dtype;
       v608 = !!v47.normalized;
       v610 = v47.size | 0;
       v609 = v47.offset | 0;
       v612 = v47.stride | 0;
       v607 = v47.divisor | 0;
      }
     }
     v618 = aColor.location;
     v619 = v0[v618];
     if (v611 === 1) {
      if (!v619.buffer) {
       v8.enableVertexAttribArray(v618);
      }
      v620 = v610 || 4;
      if (v619.type !== v613 || v619.size !== v620 || v619.buffer !== v606 || v619.normalized !== v608 || v619.offset !== v609 || v619.stride !== v612) {
       v8.bindBuffer(34962, v606.buffer);
       v8.vertexAttribPointer(v618, v620, v613, v608, v612, v609);
       v619.type = v613;
       v619.size = v620;
       v619.buffer = v606;
       v619.normalized = v608;
       v619.offset = v609;
       v619.stride = v612;
      }
      if (v619.divisor !== v607) {
       v516.vertexAttribDivisorANGLE(v618, v607);
       v619.divisor = v607;
      }
     }
     else {
      if (v619.buffer) {
       v8.disableVertexAttribArray(v618);
       v619.buffer = null;
      }
      if (v619.x !== v615 || v619.y !== v616 || v619.z !== v617 || v619.w !== v614) {
       v8.vertexAttrib4f(v618, v615, v616, v617, v614);
       v619.x = v615;
       v619.y = v616;
       v619.z = v617;
       v619.w = v614;
      }
     }
     v621 = v518['colorBuffer'];
     v49.buffer = v621;
     v622 = false;
     v623 = null;
     v624 = 0;
     v625 = false;
     v626 = 0;
     v627 = 0;
     v628 = 1;
     v629 = 0;
     v630 = 5126;
     v631 = 0;
     v632 = 0;
     v633 = 0;
     v634 = 0;
     if (v9(v49)) {
      v622 = true;
      v623 = v1.createStream(34962, v49);
      v630 = v623.dtype;
     }
     else {
      v623 = v1.getBuffer(v49);
      if (v623) {
       v630 = v623.dtype;
      }
      else if ('constant' in v49) {
       v628 = 2;
       if (typeof v49.constant === 'number') {
        v632 = v49.constant;
        v633 = v634 = v631 = 0;
       }
       else {
        v632 = v49.constant.length > 0 ? v49.constant[0] : 0;
        v633 = v49.constant.length > 1 ? v49.constant[1] : 0;
        v634 = v49.constant.length > 2 ? v49.constant[2] : 0;
        v631 = v49.constant.length > 3 ? v49.constant[3] : 0;
       }
      }
      else {
       if (v9(v49.buffer)) {
        v623 = v1.createStream(34962, v49.buffer);
       }
       else {
        v623 = v1.getBuffer(v49.buffer);
       }
       v630 = 'type' in v49 ? v43[v49.type] : v623.dtype;
       v625 = !!v49.normalized;
       v627 = v49.size | 0;
       v626 = v49.offset | 0;
       v629 = v49.stride | 0;
       v624 = v49.divisor | 0;
      }
     }
     v635 = bColor.location;
     v636 = v0[v635];
     if (v628 === 1) {
      if (!v636.buffer) {
       v8.enableVertexAttribArray(v635);
      }
      v637 = v627 || 4;
      if (v636.type !== v630 || v636.size !== v637 || v636.buffer !== v623 || v636.normalized !== v625 || v636.offset !== v626 || v636.stride !== v629) {
       v8.bindBuffer(34962, v623.buffer);
       v8.vertexAttribPointer(v635, v637, v630, v625, v629, v626);
       v636.type = v630;
       v636.size = v637;
       v636.buffer = v623;
       v636.normalized = v625;
       v636.offset = v626;
       v636.stride = v629;
      }
      if (v636.divisor !== v624) {
       v516.vertexAttribDivisorANGLE(v635, v624);
       v636.divisor = v624;
      }
     }
     else {
      if (v636.buffer) {
       v8.disableVertexAttribArray(v635);
       v636.buffer = null;
      }
      if (v636.x !== v632 || v636.y !== v633 || v636.z !== v634 || v636.w !== v631) {
       v8.vertexAttrib4f(v635, v632, v633, v634, v631);
       v636.x = v632;
       v636.y = v633;
       v636.z = v634;
       v636.w = v631;
      }
     }
     v638 = v518['scale'];
     v639 = v638[0];
     v641 = v638[1];
     if (!v517 || v640 !== v639 || v642 !== v641) {
      v640 = v639;
      v642 = v641;
      v8.uniform2f(scale.location, v639, v641);
     }
     v643 = v518['translate'];
     v644 = v643[0];
     v646 = v643[1];
     if (!v517 || v645 !== v644 || v647 !== v646) {
      v645 = v644;
      v647 = v646;
      v8.uniform2f(translate.location, v644, v646);
     }
     v648 = v518['thickness'];
     if (!v517 || v649 !== v648) {
      v649 = v648;
      v8.uniform1f(thickness.location, v648);
     }
     v650 = v518['depth'];
     if (!v517 || v651 !== v650) {
      v651 = v650;
      v8.uniform1f(depth.location, v650);
     }
     v652 = $21.call(this, v2, v518, v517);
     v653 = v652[0];
     v655 = v652[1];
     v657 = v652[2];
     v659 = v652[3];
     if (!v517 || v654 !== v653 || v656 !== v655 || v658 !== v657 || v660 !== v659) {
      v654 = v653;
      v656 = v655;
      v658 = v657;
      v660 = v659;
      v8.uniform4f(viewport.location, v653, v655, v657, v659);
     }
     v661 = v518['miterLimit'];
     if (!v517 || v662 !== v661) {
      v662 = v661;
      v8.uniform1f(miterLimit.location, v661);
     }
     v663 = $22.call(this, v2, v518, v517);
     if (!v517 || v664 !== v663) {
      v664 = v663;
      v8.uniform1f(miterMode.location, v663);
     }
     v665 = v518['dashLength'];
     if (!v517 || v666 !== v665) {
      v666 = v665;
      v8.uniform1f(dashLength.location, v665);
     }
     v667 = v518['opacity'];
     if (!v517 || v668 !== v667) {
      v668 = v667;
      v8.uniform1f(opacity.location, v667);
     }
     v669 = v518['dashTexture'];
     if (v669 && v669._reglType === 'framebuffer') {
      v669 = v669.color[0];
     }
     v670 = v669._texture;
     v8.uniform1i(dashTexture.location, v670.bind());
     v672 = v518['count'];
     if (v672 > 0) {
      if (v671) {
       v516.drawElementsInstancedANGLE(5, 4, v671.type, 0 << ((v671.type - 5121) >> 1), v672);
      }
      else {
       v516.drawArraysInstancedANGLE(5, 0, 4, v672);
      }
     }
     else if (v672 < 0) {
      if (v671) {
       v8.drawElements(5, 4, v671.type, 0 << ((v671.type - 5121) >> 1));
      }
      else {
       v8.drawArrays(5, 0, 4);
      }
     }
     v2.viewportWidth = v524;
     v2.viewportHeight = v525;
     if (v537) {
      v1.destroyStream(v538);
     }
     if (v554) {
      v1.destroyStream(v555);
     }
     if (v571) {
      v1.destroyStream(v572);
     }
     if (v588) {
      v1.destroyStream(v589);
     }
     if (v605) {
      v1.destroyStream(v606);
     }
     if (v622) {
      v1.destroyStream(v623);
     }
     v670.unbind();
    }
    v3.dirty = true;
    v15.setVAO(null);
    if (v514) {
     $1.cpuTime += performance.now() - v515;
    }
   }
   , 'draw': function (a0) {
    var v53, v54, v85, v86, v87, v88, v89, v90, v91, v92, v93, v94, v95, v96, v97, v98, v99, v100, v101, v102, v103, v104, v105, v106, v107, v108, v109, v110, v111, v112, v113, v114, v115, v116, v117, v118, v119, v120, v121, v122, v123, v124, v125, v126, v127, v128, v129, v130, v131, v132, v133, v134, v135, v136, v137, v138, v139, v140, v141, v142, v143, v144, v145, v146, v147, v148, v149, v150, v151, v152, v153, v154, v155, v156, v157, v158, v159, v160, v161, v162, v163, v164, v165, v166, v167, v168, v169, v170, v171, v172, v173, v174, v175, v176, v177, v178, v179, v180, v181, v182, v183, v184, v185, v186, v187, v188, v189, v190, v191, v192, v193, v194, v195, v196, v197, v198, v199, v200, v201, v202, v203, v204, v205, v206, v207, v208, v209, v210, v211, v212, v213, v214, v215, v216, v217, v218, v219, v220, v221, v222, v223, v224, v225, v226, v227;
    v53 = v6.angle_instanced_arrays;
    v54 = v7.next;
    if (v54 !== v7.cur) {
     if (v54) {
      v8.bindFramebuffer(36160, v54.framebuffer);
     }
     else {
      v8.bindFramebuffer(36160, null);
     }
     v7.cur = v54;
    }
    if (v3.dirty) {
     var v55, v56, v57, v58, v59, v60, v61, v62, v63, v64, v65, v66, v67, v68, v69, v70, v71, v72, v73, v74, v75, v76, v77, v78, v79, v80, v81, v82, v83, v84;
     v55 = v10.dither;
     if (v55 !== v3.dither) {
      if (v55) {
       v8.enable(3024);
      }
      else {
       v8.disable(3024);
      }
      v3.dither = v55;
     }
     v56 = v10.depth_func;
     if (v56 !== v3.depth_func) {
      v8.depthFunc(v56);
      v3.depth_func = v56;
     }
     v57 = v24[0];
     v58 = v24[1];
     if (v57 !== v25[0] || v58 !== v25[1]) {
      v8.depthRange(v57, v58);
      v25[0] = v57;
      v25[1] = v58;
     }
     v59 = v10.depth_mask;
     if (v59 !== v3.depth_mask) {
      v8.depthMask(v59);
      v3.depth_mask = v59;
     }
     v60 = v22[0];
     v61 = v22[1];
     v62 = v22[2];
     v63 = v22[3];
     if (v60 !== v23[0] || v61 !== v23[1] || v62 !== v23[2] || v63 !== v23[3]) {
      v8.colorMask(v60, v61, v62, v63);
      v23[0] = v60;
      v23[1] = v61;
      v23[2] = v62;
      v23[3] = v63;
     }
     v64 = v10.frontFace;
     if (v64 !== v3.frontFace) {
      v8.frontFace(v64);
      v3.frontFace = v64;
     }
     v65 = v10.lineWidth;
     if (v65 !== v3.lineWidth) {
      v8.lineWidth(v65);
      v3.lineWidth = v65;
     }
     v66 = v10.polygonOffset_enable;
     if (v66 !== v3.polygonOffset_enable) {
      if (v66) {
       v8.enable(32823);
      }
      else {
       v8.disable(32823);
      }
      v3.polygonOffset_enable = v66;
     }
     v67 = v26[0];
     v68 = v26[1];
     if (v67 !== v27[0] || v68 !== v27[1]) {
      v8.polygonOffset(v67, v68);
      v27[0] = v67;
      v27[1] = v68;
     }
     v69 = v10.sample_alpha;
     if (v69 !== v3.sample_alpha) {
      if (v69) {
       v8.enable(32926);
      }
      else {
       v8.disable(32926);
      }
      v3.sample_alpha = v69;
     }
     v70 = v10.sample_enable;
     if (v70 !== v3.sample_enable) {
      if (v70) {
       v8.enable(32928);
      }
      else {
       v8.disable(32928);
      }
      v3.sample_enable = v70;
     }
     v71 = v28[0];
     v72 = v28[1];
     if (v71 !== v29[0] || v72 !== v29[1]) {
      v8.sampleCoverage(v71, v72);
      v29[0] = v71;
      v29[1] = v72;
     }
     v73 = v10.stencil_mask;
     if (v73 !== v3.stencil_mask) {
      v8.stencilMask(v73);
      v3.stencil_mask = v73;
     }
     v74 = v32[0];
     v75 = v32[1];
     v76 = v32[2];
     if (v74 !== v33[0] || v75 !== v33[1] || v76 !== v33[2]) {
      v8.stencilFunc(v74, v75, v76);
      v33[0] = v74;
      v33[1] = v75;
      v33[2] = v76;
     }
     v77 = v36[0];
     v78 = v36[1];
     v79 = v36[2];
     v80 = v36[3];
     if (v77 !== v37[0] || v78 !== v37[1] || v79 !== v37[2] || v80 !== v37[3]) {
      v8.stencilOpSeparate(v77, v78, v79, v80);
      v37[0] = v77;
      v37[1] = v78;
      v37[2] = v79;
      v37[3] = v80;
     }
     v81 = v34[0];
     v82 = v34[1];
     v83 = v34[2];
     v84 = v34[3];
     if (v81 !== v35[0] || v82 !== v35[1] || v83 !== v35[2] || v84 !== v35[3]) {
      v8.stencilOpSeparate(v81, v82, v83, v84);
      v35[0] = v81;
      v35[1] = v82;
      v35[2] = v83;
      v35[3] = v84;
     }
    }
    v85 = a0['viewport'];
    v86 = v85.x | 0;
    v87 = v85.y | 0;
    v88 = 'width' in v85 ? v85.width | 0 : (v2.framebufferWidth - v86);
    v89 = 'height' in v85 ? v85.height | 0 : (v2.framebufferHeight - v87);
    v90 = v2.viewportWidth;
    v2.viewportWidth = v88;
    v91 = v2.viewportHeight;
    v2.viewportHeight = v89;
    v8.viewport(v86, v87, v88, v89);
    v39[0] = v86;
    v39[1] = v87;
    v39[2] = v88;
    v39[3] = v89;
    v8.blendColor(0, 0, 0, 0);
    v17[0] = 0;
    v17[1] = 0;
    v17[2] = 0;
    v17[3] = 0;
    v8.enable(3042);
    v3.blend_enable = true;
    v8.blendEquationSeparate(32774, 32774);
    v19[0] = 32774;
    v19[1] = 32774;
    v8.blendFuncSeparate(770, 771, 773, 1);
    v21[0] = 770;
    v21[1] = 771;
    v21[2] = 773;
    v21[3] = 1;
    v8.enable(2884);
    v3.cull_enable = true;
    v8.cullFace(1029);
    v3.cull_face = 1029;
    v92 = $2.call(this, v2, a0, 0);
    if (v92) {
     v8.enable(2929);
    }
    else {
     v8.disable(2929);
    }
    v3.depth_enable = v92;
    v93 = a0['viewport'];
    v94 = v93.x | 0;
    v95 = v93.y | 0;
    v96 = 'width' in v93 ? v93.width | 0 : (v2.framebufferWidth - v94);
    v97 = 'height' in v93 ? v93.height | 0 : (v2.framebufferHeight - v95);
    v8.scissor(v94, v95, v96, v97);
    v31[0] = v94;
    v31[1] = v95;
    v31[2] = v96;
    v31[3] = v97;
    v8.enable(3089);
    v3.scissor_enable = true;
    v8.disable(2960);
    v3.stencil_enable = false;
    v98 = v3.profile;
    if (v98) {
     v99 = performance.now();
     $1.count++;
    }
    v8.useProgram($3.program);
    v100 = v6.angle_instanced_arrays;
    v15.setVAO(null);
    v101 = a0['positionBuffer'];
    v48.buffer = v101;
    v102 = false;
    v103 = null;
    v104 = 0;
    v105 = false;
    v106 = 0;
    v107 = 0;
    v108 = 1;
    v109 = 0;
    v110 = 5126;
    v111 = 0;
    v112 = 0;
    v113 = 0;
    v114 = 0;
    if (v9(v48)) {
     v102 = true;
     v103 = v1.createStream(34962, v48);
     v110 = v103.dtype;
    }
    else {
     v103 = v1.getBuffer(v48);
     if (v103) {
      v110 = v103.dtype;
     }
     else if ('constant' in v48) {
      v108 = 2;
      if (typeof v48.constant === 'number') {
       v112 = v48.constant;
       v113 = v114 = v111 = 0;
      }
      else {
       v112 = v48.constant.length > 0 ? v48.constant[0] : 0;
       v113 = v48.constant.length > 1 ? v48.constant[1] : 0;
       v114 = v48.constant.length > 2 ? v48.constant[2] : 0;
       v111 = v48.constant.length > 3 ? v48.constant[3] : 0;
      }
     }
     else {
      if (v9(v48.buffer)) {
       v103 = v1.createStream(34962, v48.buffer);
      }
      else {
       v103 = v1.getBuffer(v48.buffer);
      }
      v110 = 'type' in v48 ? v43[v48.type] : v103.dtype;
      v105 = !!v48.normalized;
      v107 = v48.size | 0;
      v106 = v48.offset | 0;
      v109 = v48.stride | 0;
      v104 = v48.divisor | 0;
     }
    }
    v115 = aCoord.location;
    v116 = v0[v115];
    if (v108 === 1) {
     if (!v116.buffer) {
      v8.enableVertexAttribArray(v115);
     }
     v117 = v107 || 2;
     if (v116.type !== v110 || v116.size !== v117 || v116.buffer !== v103 || v116.normalized !== v105 || v116.offset !== v106 || v116.stride !== v109) {
      v8.bindBuffer(34962, v103.buffer);
      v8.vertexAttribPointer(v115, v117, v110, v105, v109, v106);
      v116.type = v110;
      v116.size = v117;
      v116.buffer = v103;
      v116.normalized = v105;
      v116.offset = v106;
      v116.stride = v109;
     }
     if (v116.divisor !== v104) {
      v100.vertexAttribDivisorANGLE(v115, v104);
      v116.divisor = v104;
     }
    }
    else {
     if (v116.buffer) {
      v8.disableVertexAttribArray(v115);
      v116.buffer = null;
     }
     if (v116.x !== v112 || v116.y !== v113 || v116.z !== v114 || v116.w !== v111) {
      v8.vertexAttrib4f(v115, v112, v113, v114, v111);
      v116.x = v112;
      v116.y = v113;
      v116.z = v114;
      v116.w = v111;
     }
    }
    v118 = a0['positionBuffer'];
    v50.buffer = v118;
    v119 = false;
    v120 = null;
    v121 = 0;
    v122 = false;
    v123 = 0;
    v124 = 0;
    v125 = 1;
    v126 = 0;
    v127 = 5126;
    v128 = 0;
    v129 = 0;
    v130 = 0;
    v131 = 0;
    if (v9(v50)) {
     v119 = true;
     v120 = v1.createStream(34962, v50);
     v127 = v120.dtype;
    }
    else {
     v120 = v1.getBuffer(v50);
     if (v120) {
      v127 = v120.dtype;
     }
     else if ('constant' in v50) {
      v125 = 2;
      if (typeof v50.constant === 'number') {
       v129 = v50.constant;
       v130 = v131 = v128 = 0;
      }
      else {
       v129 = v50.constant.length > 0 ? v50.constant[0] : 0;
       v130 = v50.constant.length > 1 ? v50.constant[1] : 0;
       v131 = v50.constant.length > 2 ? v50.constant[2] : 0;
       v128 = v50.constant.length > 3 ? v50.constant[3] : 0;
      }
     }
     else {
      if (v9(v50.buffer)) {
       v120 = v1.createStream(34962, v50.buffer);
      }
      else {
       v120 = v1.getBuffer(v50.buffer);
      }
      v127 = 'type' in v50 ? v43[v50.type] : v120.dtype;
      v122 = !!v50.normalized;
      v124 = v50.size | 0;
      v123 = v50.offset | 0;
      v126 = v50.stride | 0;
      v121 = v50.divisor | 0;
     }
    }
    v132 = bCoord.location;
    v133 = v0[v132];
    if (v125 === 1) {
     if (!v133.buffer) {
      v8.enableVertexAttribArray(v132);
     }
     v134 = v124 || 2;
     if (v133.type !== v127 || v133.size !== v134 || v133.buffer !== v120 || v133.normalized !== v122 || v133.offset !== v123 || v133.stride !== v126) {
      v8.bindBuffer(34962, v120.buffer);
      v8.vertexAttribPointer(v132, v134, v127, v122, v126, v123);
      v133.type = v127;
      v133.size = v134;
      v133.buffer = v120;
      v133.normalized = v122;
      v133.offset = v123;
      v133.stride = v126;
     }
     if (v133.divisor !== v121) {
      v100.vertexAttribDivisorANGLE(v132, v121);
      v133.divisor = v121;
     }
    }
    else {
     if (v133.buffer) {
      v8.disableVertexAttribArray(v132);
      v133.buffer = null;
     }
     if (v133.x !== v129 || v133.y !== v130 || v133.z !== v131 || v133.w !== v128) {
      v8.vertexAttrib4f(v132, v129, v130, v131, v128);
      v133.x = v129;
      v133.y = v130;
      v133.z = v131;
      v133.w = v128;
     }
    }
    v135 = a0['positionBuffer'];
    v51.buffer = v135;
    v136 = false;
    v137 = null;
    v138 = 0;
    v139 = false;
    v140 = 0;
    v141 = 0;
    v142 = 1;
    v143 = 0;
    v144 = 5126;
    v145 = 0;
    v146 = 0;
    v147 = 0;
    v148 = 0;
    if (v9(v51)) {
     v136 = true;
     v137 = v1.createStream(34962, v51);
     v144 = v137.dtype;
    }
    else {
     v137 = v1.getBuffer(v51);
     if (v137) {
      v144 = v137.dtype;
     }
     else if ('constant' in v51) {
      v142 = 2;
      if (typeof v51.constant === 'number') {
       v146 = v51.constant;
       v147 = v148 = v145 = 0;
      }
      else {
       v146 = v51.constant.length > 0 ? v51.constant[0] : 0;
       v147 = v51.constant.length > 1 ? v51.constant[1] : 0;
       v148 = v51.constant.length > 2 ? v51.constant[2] : 0;
       v145 = v51.constant.length > 3 ? v51.constant[3] : 0;
      }
     }
     else {
      if (v9(v51.buffer)) {
       v137 = v1.createStream(34962, v51.buffer);
      }
      else {
       v137 = v1.getBuffer(v51.buffer);
      }
      v144 = 'type' in v51 ? v43[v51.type] : v137.dtype;
      v139 = !!v51.normalized;
      v141 = v51.size | 0;
      v140 = v51.offset | 0;
      v143 = v51.stride | 0;
      v138 = v51.divisor | 0;
     }
    }
    v149 = nextCoord.location;
    v150 = v0[v149];
    if (v142 === 1) {
     if (!v150.buffer) {
      v8.enableVertexAttribArray(v149);
     }
     v151 = v141 || 2;
     if (v150.type !== v144 || v150.size !== v151 || v150.buffer !== v137 || v150.normalized !== v139 || v150.offset !== v140 || v150.stride !== v143) {
      v8.bindBuffer(34962, v137.buffer);
      v8.vertexAttribPointer(v149, v151, v144, v139, v143, v140);
      v150.type = v144;
      v150.size = v151;
      v150.buffer = v137;
      v150.normalized = v139;
      v150.offset = v140;
      v150.stride = v143;
     }
     if (v150.divisor !== v138) {
      v100.vertexAttribDivisorANGLE(v149, v138);
      v150.divisor = v138;
     }
    }
    else {
     if (v150.buffer) {
      v8.disableVertexAttribArray(v149);
      v150.buffer = null;
     }
     if (v150.x !== v146 || v150.y !== v147 || v150.z !== v148 || v150.w !== v145) {
      v8.vertexAttrib4f(v149, v146, v147, v148, v145);
      v150.x = v146;
      v150.y = v147;
      v150.z = v148;
      v150.w = v145;
     }
    }
    v152 = a0['positionBuffer'];
    v52.buffer = v152;
    v153 = false;
    v154 = null;
    v155 = 0;
    v156 = false;
    v157 = 0;
    v158 = 0;
    v159 = 1;
    v160 = 0;
    v161 = 5126;
    v162 = 0;
    v163 = 0;
    v164 = 0;
    v165 = 0;
    if (v9(v52)) {
     v153 = true;
     v154 = v1.createStream(34962, v52);
     v161 = v154.dtype;
    }
    else {
     v154 = v1.getBuffer(v52);
     if (v154) {
      v161 = v154.dtype;
     }
     else if ('constant' in v52) {
      v159 = 2;
      if (typeof v52.constant === 'number') {
       v163 = v52.constant;
       v164 = v165 = v162 = 0;
      }
      else {
       v163 = v52.constant.length > 0 ? v52.constant[0] : 0;
       v164 = v52.constant.length > 1 ? v52.constant[1] : 0;
       v165 = v52.constant.length > 2 ? v52.constant[2] : 0;
       v162 = v52.constant.length > 3 ? v52.constant[3] : 0;
      }
     }
     else {
      if (v9(v52.buffer)) {
       v154 = v1.createStream(34962, v52.buffer);
      }
      else {
       v154 = v1.getBuffer(v52.buffer);
      }
      v161 = 'type' in v52 ? v43[v52.type] : v154.dtype;
      v156 = !!v52.normalized;
      v158 = v52.size | 0;
      v157 = v52.offset | 0;
      v160 = v52.stride | 0;
      v155 = v52.divisor | 0;
     }
    }
    v166 = prevCoord.location;
    v167 = v0[v166];
    if (v159 === 1) {
     if (!v167.buffer) {
      v8.enableVertexAttribArray(v166);
     }
     v168 = v158 || 2;
     if (v167.type !== v161 || v167.size !== v168 || v167.buffer !== v154 || v167.normalized !== v156 || v167.offset !== v157 || v167.stride !== v160) {
      v8.bindBuffer(34962, v154.buffer);
      v8.vertexAttribPointer(v166, v168, v161, v156, v160, v157);
      v167.type = v161;
      v167.size = v168;
      v167.buffer = v154;
      v167.normalized = v156;
      v167.offset = v157;
      v167.stride = v160;
     }
     if (v167.divisor !== v155) {
      v100.vertexAttribDivisorANGLE(v166, v155);
      v167.divisor = v155;
     }
    }
    else {
     if (v167.buffer) {
      v8.disableVertexAttribArray(v166);
      v167.buffer = null;
     }
     if (v167.x !== v163 || v167.y !== v164 || v167.z !== v165 || v167.w !== v162) {
      v8.vertexAttrib4f(v166, v163, v164, v165, v162);
      v167.x = v163;
      v167.y = v164;
      v167.z = v165;
      v167.w = v162;
     }
    }
    v169 = a0['colorBuffer'];
    v47.buffer = v169;
    v170 = false;
    v171 = null;
    v172 = 0;
    v173 = false;
    v174 = 0;
    v175 = 0;
    v176 = 1;
    v177 = 0;
    v178 = 5126;
    v179 = 0;
    v180 = 0;
    v181 = 0;
    v182 = 0;
    if (v9(v47)) {
     v170 = true;
     v171 = v1.createStream(34962, v47);
     v178 = v171.dtype;
    }
    else {
     v171 = v1.getBuffer(v47);
     if (v171) {
      v178 = v171.dtype;
     }
     else if ('constant' in v47) {
      v176 = 2;
      if (typeof v47.constant === 'number') {
       v180 = v47.constant;
       v181 = v182 = v179 = 0;
      }
      else {
       v180 = v47.constant.length > 0 ? v47.constant[0] : 0;
       v181 = v47.constant.length > 1 ? v47.constant[1] : 0;
       v182 = v47.constant.length > 2 ? v47.constant[2] : 0;
       v179 = v47.constant.length > 3 ? v47.constant[3] : 0;
      }
     }
     else {
      if (v9(v47.buffer)) {
       v171 = v1.createStream(34962, v47.buffer);
      }
      else {
       v171 = v1.getBuffer(v47.buffer);
      }
      v178 = 'type' in v47 ? v43[v47.type] : v171.dtype;
      v173 = !!v47.normalized;
      v175 = v47.size | 0;
      v174 = v47.offset | 0;
      v177 = v47.stride | 0;
      v172 = v47.divisor | 0;
     }
    }
    v183 = aColor.location;
    v184 = v0[v183];
    if (v176 === 1) {
     if (!v184.buffer) {
      v8.enableVertexAttribArray(v183);
     }
     v185 = v175 || 4;
     if (v184.type !== v178 || v184.size !== v185 || v184.buffer !== v171 || v184.normalized !== v173 || v184.offset !== v174 || v184.stride !== v177) {
      v8.bindBuffer(34962, v171.buffer);
      v8.vertexAttribPointer(v183, v185, v178, v173, v177, v174);
      v184.type = v178;
      v184.size = v185;
      v184.buffer = v171;
      v184.normalized = v173;
      v184.offset = v174;
      v184.stride = v177;
     }
     if (v184.divisor !== v172) {
      v100.vertexAttribDivisorANGLE(v183, v172);
      v184.divisor = v172;
     }
    }
    else {
     if (v184.buffer) {
      v8.disableVertexAttribArray(v183);
      v184.buffer = null;
     }
     if (v184.x !== v180 || v184.y !== v181 || v184.z !== v182 || v184.w !== v179) {
      v8.vertexAttrib4f(v183, v180, v181, v182, v179);
      v184.x = v180;
      v184.y = v181;
      v184.z = v182;
      v184.w = v179;
     }
    }
    v186 = a0['colorBuffer'];
    v49.buffer = v186;
    v187 = false;
    v188 = null;
    v189 = 0;
    v190 = false;
    v191 = 0;
    v192 = 0;
    v193 = 1;
    v194 = 0;
    v195 = 5126;
    v196 = 0;
    v197 = 0;
    v198 = 0;
    v199 = 0;
    if (v9(v49)) {
     v187 = true;
     v188 = v1.createStream(34962, v49);
     v195 = v188.dtype;
    }
    else {
     v188 = v1.getBuffer(v49);
     if (v188) {
      v195 = v188.dtype;
     }
     else if ('constant' in v49) {
      v193 = 2;
      if (typeof v49.constant === 'number') {
       v197 = v49.constant;
       v198 = v199 = v196 = 0;
      }
      else {
       v197 = v49.constant.length > 0 ? v49.constant[0] : 0;
       v198 = v49.constant.length > 1 ? v49.constant[1] : 0;
       v199 = v49.constant.length > 2 ? v49.constant[2] : 0;
       v196 = v49.constant.length > 3 ? v49.constant[3] : 0;
      }
     }
     else {
      if (v9(v49.buffer)) {
       v188 = v1.createStream(34962, v49.buffer);
      }
      else {
       v188 = v1.getBuffer(v49.buffer);
      }
      v195 = 'type' in v49 ? v43[v49.type] : v188.dtype;
      v190 = !!v49.normalized;
      v192 = v49.size | 0;
      v191 = v49.offset | 0;
      v194 = v49.stride | 0;
      v189 = v49.divisor | 0;
     }
    }
    v200 = bColor.location;
    v201 = v0[v200];
    if (v193 === 1) {
     if (!v201.buffer) {
      v8.enableVertexAttribArray(v200);
     }
     v202 = v192 || 4;
     if (v201.type !== v195 || v201.size !== v202 || v201.buffer !== v188 || v201.normalized !== v190 || v201.offset !== v191 || v201.stride !== v194) {
      v8.bindBuffer(34962, v188.buffer);
      v8.vertexAttribPointer(v200, v202, v195, v190, v194, v191);
      v201.type = v195;
      v201.size = v202;
      v201.buffer = v188;
      v201.normalized = v190;
      v201.offset = v191;
      v201.stride = v194;
     }
     if (v201.divisor !== v189) {
      v100.vertexAttribDivisorANGLE(v200, v189);
      v201.divisor = v189;
     }
    }
    else {
     if (v201.buffer) {
      v8.disableVertexAttribArray(v200);
      v201.buffer = null;
     }
     if (v201.x !== v197 || v201.y !== v198 || v201.z !== v199 || v201.w !== v196) {
      v8.vertexAttrib4f(v200, v197, v198, v199, v196);
      v201.x = v197;
      v201.y = v198;
      v201.z = v199;
      v201.w = v196;
     }
    }
    v203 = lineEnd.location;
    v204 = v0[v203];
    if (!v204.buffer) {
     v8.enableVertexAttribArray(v203);
    }
    if (v204.type !== 5126 || v204.size !== 1 || v204.buffer !== $4 || v204.normalized !== false || v204.offset !== 0 || v204.stride !== 8) {
     v8.bindBuffer(34962, $4.buffer);
     v8.vertexAttribPointer(v203, 1, 5126, false, 8, 0);
     v204.type = 5126;
     v204.size = 1;
     v204.buffer = $4;
     v204.normalized = false;
     v204.offset = 0;
     v204.stride = 8;
    }
    if (v204.divisor !== 0) {
     v100.vertexAttribDivisorANGLE(v203, 0);
     v204.divisor = 0;
    }
    v205 = lineTop.location;
    v206 = v0[v205];
    if (!v206.buffer) {
     v8.enableVertexAttribArray(v205);
    }
    if (v206.type !== 5126 || v206.size !== 1 || v206.buffer !== $5 || v206.normalized !== false || v206.offset !== 4 || v206.stride !== 8) {
     v8.bindBuffer(34962, $5.buffer);
     v8.vertexAttribPointer(v205, 1, 5126, false, 8, 4);
     v206.type = 5126;
     v206.size = 1;
     v206.buffer = $5;
     v206.normalized = false;
     v206.offset = 4;
     v206.stride = 8;
    }
    if (v206.divisor !== 0) {
     v100.vertexAttribDivisorANGLE(v205, 0);
     v206.divisor = 0;
    }
    v207 = a0['scale'];
    v208 = v207[0];
    v209 = v207[1];
    v8.uniform2f(scale.location, v208, v209);
    v210 = a0['translate'];
    v211 = v210[0];
    v212 = v210[1];
    v8.uniform2f(translate.location, v211, v212);
    v213 = a0['thickness'];
    v8.uniform1f(thickness.location, v213);
    v214 = a0['depth'];
    v8.uniform1f(depth.location, v214);
    v215 = $6.call(this, v2, a0, 0);
    v216 = v215[0];
    v217 = v215[1];
    v218 = v215[2];
    v219 = v215[3];
    v8.uniform4f(viewport.location, v216, v217, v218, v219);
    v220 = a0['miterLimit'];
    v8.uniform1f(miterLimit.location, v220);
    v221 = $7.call(this, v2, a0, 0);
    v8.uniform1f(miterMode.location, v221);
    v222 = a0['dashLength'];
    v8.uniform1f(dashLength.location, v222);
    v223 = a0['opacity'];
    v8.uniform1f(opacity.location, v223);
    v224 = a0['dashTexture'];
    if (v224 && v224._reglType === 'framebuffer') {
     v224 = v224.color[0];
    }
    v225 = v224._texture;
    v8.uniform1i(dashTexture.location, v225.bind());
    v226 = v4.elements;
    if (v226) {
     v8.bindBuffer(34963, v226.buffer.buffer);
    }
    else if (v15.currentVAO) {
     v226 = v5.getElements(v15.currentVAO.elements);
     if (v226) v8.bindBuffer(34963, v226.buffer.buffer);
    }
    v227 = a0['count'];
    if (v227 > 0) {
     if (v226) {
      v100.drawElementsInstancedANGLE(5, 4, v226.type, 0 << ((v226.type - 5121) >> 1), v227);
     }
     else {
      v100.drawArraysInstancedANGLE(5, 0, 4, v227);
     }
    }
    else if (v227 < 0) {
     if (v226) {
      v8.drawElements(5, 4, v226.type, 0 << ((v226.type - 5121) >> 1));
     }
     else {
      v8.drawArrays(5, 0, 4);
     }
    }
    v3.dirty = true;
    v15.setVAO(null);
    v2.viewportWidth = v90;
    v2.viewportHeight = v91;
    if (v98) {
     $1.cpuTime += performance.now() - v99;
    }
    if (v102) {
     v1.destroyStream(v103);
    }
    if (v119) {
     v1.destroyStream(v120);
    }
    if (v136) {
     v1.destroyStream(v137);
    }
    if (v153) {
     v1.destroyStream(v154);
    }
    if (v170) {
     v1.destroyStream(v171);
    }
    if (v187) {
     v1.destroyStream(v188);
    }
    v225.unbind();
   }
   , 'scope': function (a0, a1, a2) {
    var v228, v229, v230, v231, v232, v233, v234, v235, v236, v237, v238, v239, v240, v241, v242, v243, v244, v245, v246, v247, v248, v249, v250, v251, v252, v253, v254, v255, v256, v257, v258, v259, v260, v261, v262, v263, v264, v265, v266, v267, v268, v269, v270, v271, v272, v273, v274, v275, v276, v277, v278, v279, v280, v281, v282, v283, v284, v285, v286, v287, v288, v289, v290, v291, v292, v293, v294, v295, v296, v297, v298, v299, v300, v301, v302, v303, v304, v305, v306, v307, v308, v309, v310, v311, v312, v313, v314, v315, v316, v317, v318, v319, v320, v321, v322, v323, v324, v325, v326, v327, v328, v329, v330, v331, v332, v333, v334, v335, v336, v337, v338, v339, v340, v341, v342, v343, v344, v345, v346, v347, v348, v349, v350, v351, v352, v353, v354, v355, v356, v357, v358, v359, v360, v361, v362, v363, v364, v365, v366, v367, v368, v369, v370, v371, v372, v373, v374, v375, v376, v377, v378, v379, v380, v381, v382, v383, v384, v385, v386, v387, v388, v389, v390, v391, v392, v393, v394, v395, v396, v397, v398, v399, v400, v401, v402, v403, v404, v405, v406, v407, v408, v409, v410, v411, v412, v413, v414, v415, v416, v417, v418, v419, v420, v421, v422, v423, v424, v425, v426, v427, v428, v429, v430, v431, v432, v433, v434, v435, v436, v437, v438, v439, v440, v441, v442, v443, v444, v445, v446, v447, v448, v449, v450, v451, v452, v453, v454, v455, v456, v457, v458, v459, v460, v461, v462, v463, v464, v465, v466, v467, v468, v469, v470, v471, v472, v473, v474, v475, v476, v477, v478, v479, v480, v481;
    v228 = a0['viewport'];
    v229 = v228.x | 0;
    v230 = v228.y | 0;
    v231 = 'width' in v228 ? v228.width | 0 : (v2.framebufferWidth - v229);
    v232 = 'height' in v228 ? v228.height | 0 : (v2.framebufferHeight - v230);
    v233 = v2.viewportWidth;
    v2.viewportWidth = v231;
    v234 = v2.viewportHeight;
    v2.viewportHeight = v232;
    v235 = v38[0];
    v38[0] = v229;
    v236 = v38[1];
    v38[1] = v230;
    v237 = v38[2];
    v38[2] = v231;
    v238 = v38[3];
    v38[3] = v232;
    v239 = v16[0];
    v16[0] = 0;
    v240 = v16[1];
    v16[1] = 0;
    v241 = v16[2];
    v16[2] = 0;
    v242 = v16[3];
    v16[3] = 0;
    v243 = v10.blend_enable;
    v10.blend_enable = true;
    v244 = v18[0];
    v18[0] = 32774;
    v245 = v18[1];
    v18[1] = 32774;
    v246 = v20[0];
    v20[0] = 770;
    v247 = v20[1];
    v20[1] = 771;
    v248 = v20[2];
    v20[2] = 773;
    v249 = v20[3];
    v20[3] = 1;
    v250 = v10.cull_enable;
    v10.cull_enable = true;
    v251 = v10.cull_face;
    v10.cull_face = 1029;
    v252 = $8.call(this, v2, a0, a2);
    v253 = v10.depth_enable;
    v10.depth_enable = v252;
    v254 = a0['viewport'];
    v255 = v254.x | 0;
    v256 = v254.y | 0;
    v257 = 'width' in v254 ? v254.width | 0 : (v2.framebufferWidth - v255);
    v258 = 'height' in v254 ? v254.height | 0 : (v2.framebufferHeight - v256);
    v259 = v30[0];
    v30[0] = v255;
    v260 = v30[1];
    v30[1] = v256;
    v261 = v30[2];
    v30[2] = v257;
    v262 = v30[3];
    v30[3] = v258;
    v263 = v10.scissor_enable;
    v10.scissor_enable = true;
    v264 = v10.stencil_enable;
    v10.stencil_enable = false;
    v265 = v3.profile;
    if (v265) {
     v266 = performance.now();
     $1.count++;
    }
    v267 = v4.offset;
    v4.offset = 0;
    v268 = v4.count;
    v4.count = 4;
    v269 = a0['count'];
    v270 = v4.instances;
    v4.instances = v269;
    v271 = v4.primitive;
    v4.primitive = 5;
    v272 = a0['dashLength'];
    v273 = v14[23];
    v14[23] = v272;
    v274 = a0['dashTexture'];
    v275 = v14[24];
    v14[24] = v274;
    v276 = a0['depth'];
    v277 = v14[22];
    v14[22] = v276;
    v278 = a0['id'];
    v279 = v14[31];
    v14[31] = v278;
    v280 = a0['miterLimit'];
    v281 = v14[32];
    v14[32] = v280;
    v282 = $9.call(this, v2, a0, a2);
    v283 = v14[33];
    v14[33] = v282;
    v284 = a0['opacity'];
    v285 = v14[10];
    v14[10] = v284;
    v286 = v2['pixelRatio'];
    v287 = v14[34];
    v14[34] = v286;
    v288 = a0['scale'];
    v289 = v14[6];
    v14[6] = v288;
    v290 = a0['scaleFract'];
    v291 = v14[7];
    v14[7] = v290;
    v292 = a0['thickness'];
    v293 = v14[21];
    v14[21] = v292;
    v294 = a0['translate'];
    v295 = v14[8];
    v14[8] = v294;
    v296 = a0['translateFract'];
    v297 = v14[9];
    v14[9] = v296;
    v298 = $10.call(this, v2, a0, a2);
    v299 = v14[3];
    v14[3] = v298;
    v300 = a0['colorBuffer'];
    v47.buffer = v300;
    v301 = false;
    v302 = null;
    v303 = 0;
    v304 = false;
    v305 = 0;
    v306 = 0;
    v307 = 1;
    v308 = 0;
    v309 = 5126;
    v310 = 0;
    v311 = 0;
    v312 = 0;
    v313 = 0;
    if (v9(v47)) {
     v301 = true;
     v302 = v1.createStream(34962, v47);
     v309 = v302.dtype;
    }
    else {
     v302 = v1.getBuffer(v47);
     if (v302) {
      v309 = v302.dtype;
     }
     else if ('constant' in v47) {
      v307 = 2;
      if (typeof v47.constant === 'number') {
       v311 = v47.constant;
       v312 = v313 = v310 = 0;
      }
      else {
       v311 = v47.constant.length > 0 ? v47.constant[0] : 0;
       v312 = v47.constant.length > 1 ? v47.constant[1] : 0;
       v313 = v47.constant.length > 2 ? v47.constant[2] : 0;
       v310 = v47.constant.length > 3 ? v47.constant[3] : 0;
      }
     }
     else {
      if (v9(v47.buffer)) {
       v302 = v1.createStream(34962, v47.buffer);
      }
      else {
       v302 = v1.getBuffer(v47.buffer);
      }
      v309 = 'type' in v47 ? v43[v47.type] : v302.dtype;
      v304 = !!v47.normalized;
      v306 = v47.size | 0;
      v305 = v47.offset | 0;
      v308 = v47.stride | 0;
      v303 = v47.divisor | 0;
     }
    }
    v314 = $11.buffer;
    $11.buffer = v302;
    v315 = $11.divisor;
    $11.divisor = v303;
    v316 = $11.normalized;
    $11.normalized = v304;
    v317 = $11.offset;
    $11.offset = v305;
    v318 = $11.size;
    $11.size = v306;
    v319 = $11.state;
    $11.state = v307;
    v320 = $11.stride;
    $11.stride = v308;
    v321 = $11.type;
    $11.type = v309;
    v322 = $11.w;
    $11.w = v310;
    v323 = $11.x;
    $11.x = v311;
    v324 = $11.y;
    $11.y = v312;
    v325 = $11.z;
    $11.z = v313;
    v326 = a0['positionBuffer'];
    v48.buffer = v326;
    v327 = false;
    v328 = null;
    v329 = 0;
    v330 = false;
    v331 = 0;
    v332 = 0;
    v333 = 1;
    v334 = 0;
    v335 = 5126;
    v336 = 0;
    v337 = 0;
    v338 = 0;
    v339 = 0;
    if (v9(v48)) {
     v327 = true;
     v328 = v1.createStream(34962, v48);
     v335 = v328.dtype;
    }
    else {
     v328 = v1.getBuffer(v48);
     if (v328) {
      v335 = v328.dtype;
     }
     else if ('constant' in v48) {
      v333 = 2;
      if (typeof v48.constant === 'number') {
       v337 = v48.constant;
       v338 = v339 = v336 = 0;
      }
      else {
       v337 = v48.constant.length > 0 ? v48.constant[0] : 0;
       v338 = v48.constant.length > 1 ? v48.constant[1] : 0;
       v339 = v48.constant.length > 2 ? v48.constant[2] : 0;
       v336 = v48.constant.length > 3 ? v48.constant[3] : 0;
      }
     }
     else {
      if (v9(v48.buffer)) {
       v328 = v1.createStream(34962, v48.buffer);
      }
      else {
       v328 = v1.getBuffer(v48.buffer);
      }
      v335 = 'type' in v48 ? v43[v48.type] : v328.dtype;
      v330 = !!v48.normalized;
      v332 = v48.size | 0;
      v331 = v48.offset | 0;
      v334 = v48.stride | 0;
      v329 = v48.divisor | 0;
     }
    }
    v340 = $12.buffer;
    $12.buffer = v328;
    v341 = $12.divisor;
    $12.divisor = v329;
    v342 = $12.normalized;
    $12.normalized = v330;
    v343 = $12.offset;
    $12.offset = v331;
    v344 = $12.size;
    $12.size = v332;
    v345 = $12.state;
    $12.state = v333;
    v346 = $12.stride;
    $12.stride = v334;
    v347 = $12.type;
    $12.type = v335;
    v348 = $12.w;
    $12.w = v336;
    v349 = $12.x;
    $12.x = v337;
    v350 = $12.y;
    $12.y = v338;
    v351 = $12.z;
    $12.z = v339;
    v352 = a0['colorBuffer'];
    v49.buffer = v352;
    v353 = false;
    v354 = null;
    v355 = 0;
    v356 = false;
    v357 = 0;
    v358 = 0;
    v359 = 1;
    v360 = 0;
    v361 = 5126;
    v362 = 0;
    v363 = 0;
    v364 = 0;
    v365 = 0;
    if (v9(v49)) {
     v353 = true;
     v354 = v1.createStream(34962, v49);
     v361 = v354.dtype;
    }
    else {
     v354 = v1.getBuffer(v49);
     if (v354) {
      v361 = v354.dtype;
     }
     else if ('constant' in v49) {
      v359 = 2;
      if (typeof v49.constant === 'number') {
       v363 = v49.constant;
       v364 = v365 = v362 = 0;
      }
      else {
       v363 = v49.constant.length > 0 ? v49.constant[0] : 0;
       v364 = v49.constant.length > 1 ? v49.constant[1] : 0;
       v365 = v49.constant.length > 2 ? v49.constant[2] : 0;
       v362 = v49.constant.length > 3 ? v49.constant[3] : 0;
      }
     }
     else {
      if (v9(v49.buffer)) {
       v354 = v1.createStream(34962, v49.buffer);
      }
      else {
       v354 = v1.getBuffer(v49.buffer);
      }
      v361 = 'type' in v49 ? v43[v49.type] : v354.dtype;
      v356 = !!v49.normalized;
      v358 = v49.size | 0;
      v357 = v49.offset | 0;
      v360 = v49.stride | 0;
      v355 = v49.divisor | 0;
     }
    }
    v366 = $13.buffer;
    $13.buffer = v354;
    v367 = $13.divisor;
    $13.divisor = v355;
    v368 = $13.normalized;
    $13.normalized = v356;
    v369 = $13.offset;
    $13.offset = v357;
    v370 = $13.size;
    $13.size = v358;
    v371 = $13.state;
    $13.state = v359;
    v372 = $13.stride;
    $13.stride = v360;
    v373 = $13.type;
    $13.type = v361;
    v374 = $13.w;
    $13.w = v362;
    v375 = $13.x;
    $13.x = v363;
    v376 = $13.y;
    $13.y = v364;
    v377 = $13.z;
    $13.z = v365;
    v378 = a0['positionBuffer'];
    v50.buffer = v378;
    v379 = false;
    v380 = null;
    v381 = 0;
    v382 = false;
    v383 = 0;
    v384 = 0;
    v385 = 1;
    v386 = 0;
    v387 = 5126;
    v388 = 0;
    v389 = 0;
    v390 = 0;
    v391 = 0;
    if (v9(v50)) {
     v379 = true;
     v380 = v1.createStream(34962, v50);
     v387 = v380.dtype;
    }
    else {
     v380 = v1.getBuffer(v50);
     if (v380) {
      v387 = v380.dtype;
     }
     else if ('constant' in v50) {
      v385 = 2;
      if (typeof v50.constant === 'number') {
       v389 = v50.constant;
       v390 = v391 = v388 = 0;
      }
      else {
       v389 = v50.constant.length > 0 ? v50.constant[0] : 0;
       v390 = v50.constant.length > 1 ? v50.constant[1] : 0;
       v391 = v50.constant.length > 2 ? v50.constant[2] : 0;
       v388 = v50.constant.length > 3 ? v50.constant[3] : 0;
      }
     }
     else {
      if (v9(v50.buffer)) {
       v380 = v1.createStream(34962, v50.buffer);
      }
      else {
       v380 = v1.getBuffer(v50.buffer);
      }
      v387 = 'type' in v50 ? v43[v50.type] : v380.dtype;
      v382 = !!v50.normalized;
      v384 = v50.size | 0;
      v383 = v50.offset | 0;
      v386 = v50.stride | 0;
      v381 = v50.divisor | 0;
     }
    }
    v392 = $14.buffer;
    $14.buffer = v380;
    v393 = $14.divisor;
    $14.divisor = v381;
    v394 = $14.normalized;
    $14.normalized = v382;
    v395 = $14.offset;
    $14.offset = v383;
    v396 = $14.size;
    $14.size = v384;
    v397 = $14.state;
    $14.state = v385;
    v398 = $14.stride;
    $14.stride = v386;
    v399 = $14.type;
    $14.type = v387;
    v400 = $14.w;
    $14.w = v388;
    v401 = $14.x;
    $14.x = v389;
    v402 = $14.y;
    $14.y = v390;
    v403 = $14.z;
    $14.z = v391;
    v404 = $15.buffer;
    $15.buffer = $4;
    v405 = $15.divisor;
    $15.divisor = 0;
    v406 = $15.normalized;
    $15.normalized = false;
    v407 = $15.offset;
    $15.offset = 0;
    v408 = $15.size;
    $15.size = 0;
    v409 = $15.state;
    $15.state = 1;
    v410 = $15.stride;
    $15.stride = 8;
    v411 = $15.type;
    $15.type = 5126;
    v412 = $15.w;
    $15.w = 0;
    v413 = $15.x;
    $15.x = 0;
    v414 = $15.y;
    $15.y = 0;
    v415 = $15.z;
    $15.z = 0;
    v416 = $16.buffer;
    $16.buffer = $5;
    v417 = $16.divisor;
    $16.divisor = 0;
    v418 = $16.normalized;
    $16.normalized = false;
    v419 = $16.offset;
    $16.offset = 4;
    v420 = $16.size;
    $16.size = 0;
    v421 = $16.state;
    $16.state = 1;
    v422 = $16.stride;
    $16.stride = 8;
    v423 = $16.type;
    $16.type = 5126;
    v424 = $16.w;
    $16.w = 0;
    v425 = $16.x;
    $16.x = 0;
    v426 = $16.y;
    $16.y = 0;
    v427 = $16.z;
    $16.z = 0;
    v428 = a0['positionBuffer'];
    v51.buffer = v428;
    v429 = false;
    v430 = null;
    v431 = 0;
    v432 = false;
    v433 = 0;
    v434 = 0;
    v435 = 1;
    v436 = 0;
    v437 = 5126;
    v438 = 0;
    v439 = 0;
    v440 = 0;
    v441 = 0;
    if (v9(v51)) {
     v429 = true;
     v430 = v1.createStream(34962, v51);
     v437 = v430.dtype;
    }
    else {
     v430 = v1.getBuffer(v51);
     if (v430) {
      v437 = v430.dtype;
     }
     else if ('constant' in v51) {
      v435 = 2;
      if (typeof v51.constant === 'number') {
       v439 = v51.constant;
       v440 = v441 = v438 = 0;
      }
      else {
       v439 = v51.constant.length > 0 ? v51.constant[0] : 0;
       v440 = v51.constant.length > 1 ? v51.constant[1] : 0;
       v441 = v51.constant.length > 2 ? v51.constant[2] : 0;
       v438 = v51.constant.length > 3 ? v51.constant[3] : 0;
      }
     }
     else {
      if (v9(v51.buffer)) {
       v430 = v1.createStream(34962, v51.buffer);
      }
      else {
       v430 = v1.getBuffer(v51.buffer);
      }
      v437 = 'type' in v51 ? v43[v51.type] : v430.dtype;
      v432 = !!v51.normalized;
      v434 = v51.size | 0;
      v433 = v51.offset | 0;
      v436 = v51.stride | 0;
      v431 = v51.divisor | 0;
     }
    }
    v442 = $17.buffer;
    $17.buffer = v430;
    v443 = $17.divisor;
    $17.divisor = v431;
    v444 = $17.normalized;
    $17.normalized = v432;
    v445 = $17.offset;
    $17.offset = v433;
    v446 = $17.size;
    $17.size = v434;
    v447 = $17.state;
    $17.state = v435;
    v448 = $17.stride;
    $17.stride = v436;
    v449 = $17.type;
    $17.type = v437;
    v450 = $17.w;
    $17.w = v438;
    v451 = $17.x;
    $17.x = v439;
    v452 = $17.y;
    $17.y = v440;
    v453 = $17.z;
    $17.z = v441;
    v454 = a0['positionBuffer'];
    v52.buffer = v454;
    v455 = false;
    v456 = null;
    v457 = 0;
    v458 = false;
    v459 = 0;
    v460 = 0;
    v461 = 1;
    v462 = 0;
    v463 = 5126;
    v464 = 0;
    v465 = 0;
    v466 = 0;
    v467 = 0;
    if (v9(v52)) {
     v455 = true;
     v456 = v1.createStream(34962, v52);
     v463 = v456.dtype;
    }
    else {
     v456 = v1.getBuffer(v52);
     if (v456) {
      v463 = v456.dtype;
     }
     else if ('constant' in v52) {
      v461 = 2;
      if (typeof v52.constant === 'number') {
       v465 = v52.constant;
       v466 = v467 = v464 = 0;
      }
      else {
       v465 = v52.constant.length > 0 ? v52.constant[0] : 0;
       v466 = v52.constant.length > 1 ? v52.constant[1] : 0;
       v467 = v52.constant.length > 2 ? v52.constant[2] : 0;
       v464 = v52.constant.length > 3 ? v52.constant[3] : 0;
      }
     }
     else {
      if (v9(v52.buffer)) {
       v456 = v1.createStream(34962, v52.buffer);
      }
      else {
       v456 = v1.getBuffer(v52.buffer);
      }
      v463 = 'type' in v52 ? v43[v52.type] : v456.dtype;
      v458 = !!v52.normalized;
      v460 = v52.size | 0;
      v459 = v52.offset | 0;
      v462 = v52.stride | 0;
      v457 = v52.divisor | 0;
     }
    }
    v468 = $18.buffer;
    $18.buffer = v456;
    v469 = $18.divisor;
    $18.divisor = v457;
    v470 = $18.normalized;
    $18.normalized = v458;
    v471 = $18.offset;
    $18.offset = v459;
    v472 = $18.size;
    $18.size = v460;
    v473 = $18.state;
    $18.state = v461;
    v474 = $18.stride;
    $18.stride = v462;
    v475 = $18.type;
    $18.type = v463;
    v476 = $18.w;
    $18.w = v464;
    v477 = $18.x;
    $18.x = v465;
    v478 = $18.y;
    $18.y = v466;
    v479 = $18.z;
    $18.z = v467;
    v480 = v11.vert;
    v11.vert = 36;
    v481 = v11.frag;
    v11.frag = 35;
    v3.dirty = true;
    a1(v2, a0, a2);
    v2.viewportWidth = v233;
    v2.viewportHeight = v234;
    v38[0] = v235;
    v38[1] = v236;
    v38[2] = v237;
    v38[3] = v238;
    v16[0] = v239;
    v16[1] = v240;
    v16[2] = v241;
    v16[3] = v242;
    v10.blend_enable = v243;
    v18[0] = v244;
    v18[1] = v245;
    v20[0] = v246;
    v20[1] = v247;
    v20[2] = v248;
    v20[3] = v249;
    v10.cull_enable = v250;
    v10.cull_face = v251;
    v10.depth_enable = v253;
    v30[0] = v259;
    v30[1] = v260;
    v30[2] = v261;
    v30[3] = v262;
    v10.scissor_enable = v263;
    v10.stencil_enable = v264;
    if (v265) {
     $1.cpuTime += performance.now() - v266;
    }
    v4.offset = v267;
    v4.count = v268;
    v4.instances = v270;
    v4.primitive = v271;
    v14[23] = v273;
    v14[24] = v275;
    v14[22] = v277;
    v14[31] = v279;
    v14[32] = v281;
    v14[33] = v283;
    v14[10] = v285;
    v14[34] = v287;
    v14[6] = v289;
    v14[7] = v291;
    v14[21] = v293;
    v14[8] = v295;
    v14[9] = v297;
    v14[3] = v299;
    if (v301) {
     v1.destroyStream(v302);
    }
    $11.buffer = v314;
    $11.divisor = v315;
    $11.normalized = v316;
    $11.offset = v317;
    $11.size = v318;
    $11.state = v319;
    $11.stride = v320;
    $11.type = v321;
    $11.w = v322;
    $11.x = v323;
    $11.y = v324;
    $11.z = v325;
    if (v327) {
     v1.destroyStream(v328);
    }
    $12.buffer = v340;
    $12.divisor = v341;
    $12.normalized = v342;
    $12.offset = v343;
    $12.size = v344;
    $12.state = v345;
    $12.stride = v346;
    $12.type = v347;
    $12.w = v348;
    $12.x = v349;
    $12.y = v350;
    $12.z = v351;
    if (v353) {
     v1.destroyStream(v354);
    }
    $13.buffer = v366;
    $13.divisor = v367;
    $13.normalized = v368;
    $13.offset = v369;
    $13.size = v370;
    $13.state = v371;
    $13.stride = v372;
    $13.type = v373;
    $13.w = v374;
    $13.x = v375;
    $13.y = v376;
    $13.z = v377;
    if (v379) {
     v1.destroyStream(v380);
    }
    $14.buffer = v392;
    $14.divisor = v393;
    $14.normalized = v394;
    $14.offset = v395;
    $14.size = v396;
    $14.state = v397;
    $14.stride = v398;
    $14.type = v399;
    $14.w = v400;
    $14.x = v401;
    $14.y = v402;
    $14.z = v403;
    $15.buffer = v404;
    $15.divisor = v405;
    $15.normalized = v406;
    $15.offset = v407;
    $15.size = v408;
    $15.state = v409;
    $15.stride = v410;
    $15.type = v411;
    $15.w = v412;
    $15.x = v413;
    $15.y = v414;
    $15.z = v415;
    $16.buffer = v416;
    $16.divisor = v417;
    $16.normalized = v418;
    $16.offset = v419;
    $16.size = v420;
    $16.state = v421;
    $16.stride = v422;
    $16.type = v423;
    $16.w = v424;
    $16.x = v425;
    $16.y = v426;
    $16.z = v427;
    if (v429) {
     v1.destroyStream(v430);
    }
    $17.buffer = v442;
    $17.divisor = v443;
    $17.normalized = v444;
    $17.offset = v445;
    $17.size = v446;
    $17.state = v447;
    $17.stride = v448;
    $17.type = v449;
    $17.w = v450;
    $17.x = v451;
    $17.y = v452;
    $17.z = v453;
    if (v455) {
     v1.destroyStream(v456);
    }
    $18.buffer = v468;
    $18.divisor = v469;
    $18.normalized = v470;
    $18.offset = v471;
    $18.size = v472;
    $18.state = v473;
    $18.stride = v474;
    $18.type = v475;
    $18.w = v476;
    $18.x = v477;
    $18.y = v478;
    $18.z = v479;
    v11.vert = v480;
    v11.frag = v481;
    v3.dirty = true;
   }
   ,
  }

 },
 '$9,color,id,opacity,position,positionFract,scale,scaleFract,translate,translateFract': function ($0, $1, $2, $3, $4, $5, $6, $7, $8, $9, color, id, opacity, position, positionFract, scale, scaleFract, translate, translateFract
 ) {
  'use strict';
  var v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15, v16, v17, v18, v19, v20, v21, v22, v23, v24, v25, v26, v27, v28, v29, v30, v31, v32, v33, v34, v35, v36, v37, v38, v39, v40, v41, v42, v43, v44, v45, v46, v47, v48;
  v0 = $0.attributes;
  v1 = $0.buffer;
  v2 = $0.context;
  v3 = $0.current;
  v4 = $0.draw;
  v5 = $0.elements;
  v6 = $0.extensions;
  v7 = $0.framebuffer;
  v8 = $0.gl;
  v9 = $0.isBufferArgs;
  v10 = $0.next;
  v11 = $0.shader;
  v12 = $0.strings;
  v13 = $0.timer;
  v14 = $0.uniforms;
  v15 = $0.vao;
  v16 = v10.blend_color;
  v17 = v3.blend_color;
  v18 = v10.blend_equation;
  v19 = v3.blend_equation;
  v20 = v10.blend_func;
  v21 = v3.blend_func;
  v22 = v10.colorMask;
  v23 = v3.colorMask;
  v24 = v10.depth_range;
  v25 = v3.depth_range;
  v26 = v10.polygonOffset_offset;
  v27 = v3.polygonOffset_offset;
  v28 = v10.sample_coverage;
  v29 = v3.sample_coverage;
  v30 = v10.scissor_box;
  v31 = v3.scissor_box;
  v32 = v10.stencil_func;
  v33 = v3.stencil_func;
  v34 = v10.stencil_opBack;
  v35 = v3.stencil_opBack;
  v36 = v10.stencil_opFront;
  v37 = v3.stencil_opFront;
  v38 = v10.viewport;
  v39 = v3.viewport;
  v40 = {
   'add': 32774, 'subtract': 32778, 'reverse subtract': 32779
  }
   ;
  v41 = {
   '0': 0, '1': 1, 'zero': 0, 'one': 1, 'src color': 768, 'one minus src color': 769, 'src alpha': 770, 'one minus src alpha': 771, 'dst color': 774, 'one minus dst color': 775, 'dst alpha': 772, 'one minus dst alpha': 773, 'constant color': 32769, 'one minus constant color': 32770, 'constant alpha': 32771, 'one minus constant alpha': 32772, 'src alpha saturate': 776
  }
   ;
  v42 = {
   'never': 512, 'less': 513, '<': 513, 'equal': 514, '=': 514, '==': 514, '===': 514, 'lequal': 515, '<=': 515, 'greater': 516, '>': 516, 'notequal': 517, '!=': 517, '!==': 517, 'gequal': 518, '>=': 518, 'always': 519
  }
   ;
  v43 = {
   'int8': 5120, 'int16': 5122, 'int32': 5124, 'uint8': 5121, 'uint16': 5123, 'uint32': 5125, 'float': 5126, 'float32': 5126
  }
   ;
  v44 = {
   'cw': 2304, 'ccw': 2305
  }
   ;
  v45 = {
   'points': 0, 'point': 0, 'lines': 1, 'line': 1, 'triangles': 4, 'triangle': 4, 'line loop': 2, 'line strip': 3, 'triangle strip': 5, 'triangle fan': 6
  }
   ;
  v46 = {
   '0': 0, 'zero': 0, 'keep': 7680, 'replace': 7681, 'increment': 7682, 'decrement': 7683, 'increment wrap': 34055, 'decrement wrap': 34056, 'invert': 5386
  }
   ;
  v47 = {
  }
   ;
  v47.offset = 8;
  v47.stride = 8;
  v48 = {
  }
   ;
  v48.offset = 8;
  v48.stride = 8;
  return {
   'batch': function (a0, a1) {
    var v272, v273, v306, v307, v308, v309, v310;
    v272 = v6.angle_instanced_arrays;
    v273 = v7.next;
    if (v273 !== v7.cur) {
     if (v273) {
      v8.bindFramebuffer(36160, v273.framebuffer);
     }
     else {
      v8.bindFramebuffer(36160, null);
     }
     v7.cur = v273;
    }
    if (v3.dirty) {
     var v274, v275, v276, v277, v278, v279, v280, v281, v282, v283, v284, v285, v286, v287, v288, v289, v290, v291, v292, v293, v294, v295, v296, v297, v298, v299, v300, v301, v302, v303, v304, v305;
     v274 = v10.dither;
     if (v274 !== v3.dither) {
      if (v274) {
       v8.enable(3024);
      }
      else {
       v8.disable(3024);
      }
      v3.dither = v274;
     }
     v275 = v10.depth_func;
     if (v275 !== v3.depth_func) {
      v8.depthFunc(v275);
      v3.depth_func = v275;
     }
     v276 = v24[0];
     v277 = v24[1];
     if (v276 !== v25[0] || v277 !== v25[1]) {
      v8.depthRange(v276, v277);
      v25[0] = v276;
      v25[1] = v277;
     }
     v278 = v10.depth_mask;
     if (v278 !== v3.depth_mask) {
      v8.depthMask(v278);
      v3.depth_mask = v278;
     }
     v279 = v22[0];
     v280 = v22[1];
     v281 = v22[2];
     v282 = v22[3];
     if (v279 !== v23[0] || v280 !== v23[1] || v281 !== v23[2] || v282 !== v23[3]) {
      v8.colorMask(v279, v280, v281, v282);
      v23[0] = v279;
      v23[1] = v280;
      v23[2] = v281;
      v23[3] = v282;
     }
     v283 = v10.cull_enable;
     if (v283 !== v3.cull_enable) {
      if (v283) {
       v8.enable(2884);
      }
      else {
       v8.disable(2884);
      }
      v3.cull_enable = v283;
     }
     v284 = v10.cull_face;
     if (v284 !== v3.cull_face) {
      v8.cullFace(v284);
      v3.cull_face = v284;
     }
     v285 = v10.frontFace;
     if (v285 !== v3.frontFace) {
      v8.frontFace(v285);
      v3.frontFace = v285;
     }
     v286 = v10.lineWidth;
     if (v286 !== v3.lineWidth) {
      v8.lineWidth(v286);
      v3.lineWidth = v286;
     }
     v287 = v10.polygonOffset_enable;
     if (v287 !== v3.polygonOffset_enable) {
      if (v287) {
       v8.enable(32823);
      }
      else {
       v8.disable(32823);
      }
      v3.polygonOffset_enable = v287;
     }
     v288 = v26[0];
     v289 = v26[1];
     if (v288 !== v27[0] || v289 !== v27[1]) {
      v8.polygonOffset(v288, v289);
      v27[0] = v288;
      v27[1] = v289;
     }
     v290 = v10.sample_alpha;
     if (v290 !== v3.sample_alpha) {
      if (v290) {
       v8.enable(32926);
      }
      else {
       v8.disable(32926);
      }
      v3.sample_alpha = v290;
     }
     v291 = v10.sample_enable;
     if (v291 !== v3.sample_enable) {
      if (v291) {
       v8.enable(32928);
      }
      else {
       v8.disable(32928);
      }
      v3.sample_enable = v291;
     }
     v292 = v28[0];
     v293 = v28[1];
     if (v292 !== v29[0] || v293 !== v29[1]) {
      v8.sampleCoverage(v292, v293);
      v29[0] = v292;
      v29[1] = v293;
     }
     v294 = v10.stencil_mask;
     if (v294 !== v3.stencil_mask) {
      v8.stencilMask(v294);
      v3.stencil_mask = v294;
     }
     v295 = v32[0];
     v296 = v32[1];
     v297 = v32[2];
     if (v295 !== v33[0] || v296 !== v33[1] || v297 !== v33[2]) {
      v8.stencilFunc(v295, v296, v297);
      v33[0] = v295;
      v33[1] = v296;
      v33[2] = v297;
     }
     v298 = v36[0];
     v299 = v36[1];
     v300 = v36[2];
     v301 = v36[3];
     if (v298 !== v37[0] || v299 !== v37[1] || v300 !== v37[2] || v301 !== v37[3]) {
      v8.stencilOpSeparate(v298, v299, v300, v301);
      v37[0] = v298;
      v37[1] = v299;
      v37[2] = v300;
      v37[3] = v301;
     }
     v302 = v34[0];
     v303 = v34[1];
     v304 = v34[2];
     v305 = v34[3];
     if (v302 !== v35[0] || v303 !== v35[1] || v304 !== v35[2] || v305 !== v35[3]) {
      v8.stencilOpSeparate(v302, v303, v304, v305);
      v35[0] = v302;
      v35[1] = v303;
      v35[2] = v304;
      v35[3] = v305;
     }
    }
    v8.blendColor(0, 0, 0, 0);
    v17[0] = 0;
    v17[1] = 0;
    v17[2] = 0;
    v17[3] = 0;
    v8.enable(3042);
    v3.blend_enable = true;
    v8.blendEquationSeparate(32774, 32774);
    v19[0] = 32774;
    v19[1] = 32774;
    v8.blendFuncSeparate(770, 771, 773, 1);
    v21[0] = 770;
    v21[1] = 771;
    v21[2] = 773;
    v21[3] = 1;
    v8.disable(2929);
    v3.depth_enable = false;
    v8.enable(3089);
    v3.scissor_enable = true;
    v8.disable(2960);
    v3.stencil_enable = false;
    v306 = v3.profile;
    if (v306) {
     v307 = performance.now();
     $1.count += a1;
    }
    v8.useProgram($8.program);
    v308 = v6.angle_instanced_arrays;
    var v394;
    v15.setVAO(null);
    v394 = v4.instances;
    for (v309 = 0;
     v309 < a1;
     ++v309) {
     v310 = a0[v309];
     var v311, v312, v313, v314, v315, v316, v317, v318, v319, v320, v321, v322, v323, v324, v325, v326, v327, v328, v329, v330, v331, v332, v333, v334, v335, v336, v337, v338, v339, v340, v341, v342, v343, v344, v345, v346, v347, v348, v349, v350, v351, v352, v353, v354, v355, v356, v357, v358, v359, v360, v361, v362, v363, v364, v365, v366, v367, v368, v369, v370, v371, v372, v373, v374, v375, v376, v377, v378, v379, v380, v381, v382, v383, v384, v385, v386, v387, v388, v389, v390, v391, v392, v393;
     v311 = v310['viewport'];
     v312 = v311.x | 0;
     v313 = v311.y | 0;
     v314 = 'width' in v311 ? v311.width | 0 : (v2.framebufferWidth - v312);
     v315 = 'height' in v311 ? v311.height | 0 : (v2.framebufferHeight - v313);
     v316 = v2.viewportWidth;
     v2.viewportWidth = v314;
     v317 = v2.viewportHeight;
     v2.viewportHeight = v315;
     v8.viewport(v312, v313, v314, v315);
     v39[0] = v312;
     v39[1] = v313;
     v39[2] = v314;
     v39[3] = v315;
     v318 = v310['viewport'];
     v319 = v318.x | 0;
     v320 = v318.y | 0;
     v321 = 'width' in v318 ? v318.width | 0 : (v2.framebufferWidth - v319);
     v322 = 'height' in v318 ? v318.height | 0 : (v2.framebufferHeight - v320);
     v8.scissor(v319, v320, v321, v322);
     v31[0] = v319;
     v31[1] = v320;
     v31[2] = v321;
     v31[3] = v322;
     v323 = v310['positionBuffer'];
     v47.buffer = v323;
     v324 = false;
     v325 = null;
     v326 = 0;
     v327 = false;
     v328 = 0;
     v329 = 0;
     v330 = 1;
     v331 = 0;
     v332 = 5126;
     v333 = 0;
     v334 = 0;
     v335 = 0;
     v336 = 0;
     if (v9(v47)) {
      v324 = true;
      v325 = v1.createStream(34962, v47);
      v332 = v325.dtype;
     }
     else {
      v325 = v1.getBuffer(v47);
      if (v325) {
       v332 = v325.dtype;
      }
      else if ('constant' in v47) {
       v330 = 2;
       if (typeof v47.constant === 'number') {
        v334 = v47.constant;
        v335 = v336 = v333 = 0;
       }
       else {
        v334 = v47.constant.length > 0 ? v47.constant[0] : 0;
        v335 = v47.constant.length > 1 ? v47.constant[1] : 0;
        v336 = v47.constant.length > 2 ? v47.constant[2] : 0;
        v333 = v47.constant.length > 3 ? v47.constant[3] : 0;
       }
      }
      else {
       if (v9(v47.buffer)) {
        v325 = v1.createStream(34962, v47.buffer);
       }
       else {
        v325 = v1.getBuffer(v47.buffer);
       }
       v332 = 'type' in v47 ? v43[v47.type] : v325.dtype;
       v327 = !!v47.normalized;
       v329 = v47.size | 0;
       v328 = v47.offset | 0;
       v331 = v47.stride | 0;
       v326 = v47.divisor | 0;
      }
     }
     v337 = position.location;
     v338 = v0[v337];
     if (v330 === 1) {
      if (!v338.buffer) {
       v8.enableVertexAttribArray(v337);
      }
      v339 = v329 || 2;
      if (v338.type !== v332 || v338.size !== v339 || v338.buffer !== v325 || v338.normalized !== v327 || v338.offset !== v328 || v338.stride !== v331) {
       v8.bindBuffer(34962, v325.buffer);
       v8.vertexAttribPointer(v337, v339, v332, v327, v331, v328);
       v338.type = v332;
       v338.size = v339;
       v338.buffer = v325;
       v338.normalized = v327;
       v338.offset = v328;
       v338.stride = v331;
      }
      if (v338.divisor !== v326) {
       v308.vertexAttribDivisorANGLE(v337, v326);
       v338.divisor = v326;
      }
     }
     else {
      if (v338.buffer) {
       v8.disableVertexAttribArray(v337);
       v338.buffer = null;
      }
      if (v338.x !== v334 || v338.y !== v335 || v338.z !== v336 || v338.w !== v333) {
       v8.vertexAttrib4f(v337, v334, v335, v336, v333);
       v338.x = v334;
       v338.y = v335;
       v338.z = v336;
       v338.w = v333;
      }
     }
     v340 = v310['positionFractBuffer'];
     v48.buffer = v340;
     v341 = false;
     v342 = null;
     v343 = 0;
     v344 = false;
     v345 = 0;
     v346 = 0;
     v347 = 1;
     v348 = 0;
     v349 = 5126;
     v350 = 0;
     v351 = 0;
     v352 = 0;
     v353 = 0;
     if (v9(v48)) {
      v341 = true;
      v342 = v1.createStream(34962, v48);
      v349 = v342.dtype;
     }
     else {
      v342 = v1.getBuffer(v48);
      if (v342) {
       v349 = v342.dtype;
      }
      else if ('constant' in v48) {
       v347 = 2;
       if (typeof v48.constant === 'number') {
        v351 = v48.constant;
        v352 = v353 = v350 = 0;
       }
       else {
        v351 = v48.constant.length > 0 ? v48.constant[0] : 0;
        v352 = v48.constant.length > 1 ? v48.constant[1] : 0;
        v353 = v48.constant.length > 2 ? v48.constant[2] : 0;
        v350 = v48.constant.length > 3 ? v48.constant[3] : 0;
       }
      }
      else {
       if (v9(v48.buffer)) {
        v342 = v1.createStream(34962, v48.buffer);
       }
       else {
        v342 = v1.getBuffer(v48.buffer);
       }
       v349 = 'type' in v48 ? v43[v48.type] : v342.dtype;
       v344 = !!v48.normalized;
       v346 = v48.size | 0;
       v345 = v48.offset | 0;
       v348 = v48.stride | 0;
       v343 = v48.divisor | 0;
      }
     }
     v354 = positionFract.location;
     v355 = v0[v354];
     if (v347 === 1) {
      if (!v355.buffer) {
       v8.enableVertexAttribArray(v354);
      }
      v356 = v346 || 2;
      if (v355.type !== v349 || v355.size !== v356 || v355.buffer !== v342 || v355.normalized !== v344 || v355.offset !== v345 || v355.stride !== v348) {
       v8.bindBuffer(34962, v342.buffer);
       v8.vertexAttribPointer(v354, v356, v349, v344, v348, v345);
       v355.type = v349;
       v355.size = v356;
       v355.buffer = v342;
       v355.normalized = v344;
       v355.offset = v345;
       v355.stride = v348;
      }
      if (v355.divisor !== v343) {
       v308.vertexAttribDivisorANGLE(v354, v343);
       v355.divisor = v343;
      }
     }
     else {
      if (v355.buffer) {
       v8.disableVertexAttribArray(v354);
       v355.buffer = null;
      }
      if (v355.x !== v351 || v355.y !== v352 || v355.z !== v353 || v355.w !== v350) {
       v8.vertexAttrib4f(v354, v351, v352, v353, v350);
       v355.x = v351;
       v355.y = v352;
       v355.z = v353;
       v355.w = v350;
      }
     }
     v357 = v310['fill'];
     v358 = v357[0];
     v360 = v357[1];
     v362 = v357[2];
     v364 = v357[3];
     if (!v309 || v359 !== v358 || v361 !== v360 || v363 !== v362 || v365 !== v364) {
      v359 = v358;
      v361 = v360;
      v363 = v362;
      v365 = v364;
      v8.uniform4f(color.location, v358, v360, v362, v364);
     }
     v366 = v310['scale'];
     v367 = v366[0];
     v369 = v366[1];
     if (!v309 || v368 !== v367 || v370 !== v369) {
      v368 = v367;
      v370 = v369;
      v8.uniform2f(scale.location, v367, v369);
     }
     v371 = v310['scaleFract'];
     v372 = v371[0];
     v374 = v371[1];
     if (!v309 || v373 !== v372 || v375 !== v374) {
      v373 = v372;
      v375 = v374;
      v8.uniform2f(scaleFract.location, v372, v374);
     }
     v376 = v310['translate'];
     v377 = v376[0];
     v379 = v376[1];
     if (!v309 || v378 !== v377 || v380 !== v379) {
      v378 = v377;
      v380 = v379;
      v8.uniform2f(translate.location, v377, v379);
     }
     v381 = v310['translateFract'];
     v382 = v381[0];
     v384 = v381[1];
     if (!v309 || v383 !== v382 || v385 !== v384) {
      v383 = v382;
      v385 = v384;
      v8.uniform2f(translateFract.location, v382, v384);
     }
     v386 = v310['id'];
     if (!v309 || v387 !== v386) {
      v387 = v386;
      v8.uniform1f(id.location, v386);
     }
     v388 = v310['opacity'];
     if (!v309 || v389 !== v388) {
      v389 = v388;
      v8.uniform1f(opacity.location, v388);
     }
     v390 = $9.call(this, v2, v310, v309);
     v391 = null;
     v392 = v9(v390);
     if (v392) {
      v391 = v5.createStream(v390);
     }
     else {
      v391 = v5.getElements(v390);
     }
     if (v391) v8.bindBuffer(34963, v391.buffer.buffer);
     v393 = v391 ? v391.vertCount : -1;
     if (v393) {
      if (v394 > 0) {
       if (v391) {
        v308.drawElementsInstancedANGLE(4, v393, v391.type, 0 << ((v391.type - 5121) >> 1), v394);
       }
       else {
        v308.drawArraysInstancedANGLE(4, 0, v393, v394);
       }
      }
      else if (v394 < 0) {
       if (v391) {
        v8.drawElements(4, v393, v391.type, 0 << ((v391.type - 5121) >> 1));
       }
       else {
        v8.drawArrays(4, 0, v393);
       }
      }
      v2.viewportWidth = v316;
      v2.viewportHeight = v317;
      if (v324) {
       v1.destroyStream(v325);
      }
      if (v341) {
       v1.destroyStream(v342);
      }
      if (v392) {
       v5.destroyStream(v391);
      }
     }
    }
    v3.dirty = true;
    v15.setVAO(null);
    if (v306) {
     $1.cpuTime += performance.now() - v307;
    }
   }
   , 'draw': function (a0) {
    var v49, v50, v83, v84, v85, v86, v87, v88, v89, v90, v91, v92, v93, v94, v95, v96, v97, v98, v99, v100, v101, v102, v103, v104, v105, v106, v107, v108, v109, v110, v111, v112, v113, v114, v115, v116, v117, v118, v119, v120, v121, v122, v123, v124, v125, v126, v127, v128, v129, v130, v131, v132, v133, v134, v135, v136, v137, v138, v139, v140, v141, v142, v143, v144, v145, v146, v147, v148, v149, v150, v151, v152, v153, v154, v155;
    v49 = v6.angle_instanced_arrays;
    v50 = v7.next;
    if (v50 !== v7.cur) {
     if (v50) {
      v8.bindFramebuffer(36160, v50.framebuffer);
     }
     else {
      v8.bindFramebuffer(36160, null);
     }
     v7.cur = v50;
    }
    if (v3.dirty) {
     var v51, v52, v53, v54, v55, v56, v57, v58, v59, v60, v61, v62, v63, v64, v65, v66, v67, v68, v69, v70, v71, v72, v73, v74, v75, v76, v77, v78, v79, v80, v81, v82;
     v51 = v10.dither;
     if (v51 !== v3.dither) {
      if (v51) {
       v8.enable(3024);
      }
      else {
       v8.disable(3024);
      }
      v3.dither = v51;
     }
     v52 = v10.depth_func;
     if (v52 !== v3.depth_func) {
      v8.depthFunc(v52);
      v3.depth_func = v52;
     }
     v53 = v24[0];
     v54 = v24[1];
     if (v53 !== v25[0] || v54 !== v25[1]) {
      v8.depthRange(v53, v54);
      v25[0] = v53;
      v25[1] = v54;
     }
     v55 = v10.depth_mask;
     if (v55 !== v3.depth_mask) {
      v8.depthMask(v55);
      v3.depth_mask = v55;
     }
     v56 = v22[0];
     v57 = v22[1];
     v58 = v22[2];
     v59 = v22[3];
     if (v56 !== v23[0] || v57 !== v23[1] || v58 !== v23[2] || v59 !== v23[3]) {
      v8.colorMask(v56, v57, v58, v59);
      v23[0] = v56;
      v23[1] = v57;
      v23[2] = v58;
      v23[3] = v59;
     }
     v60 = v10.cull_enable;
     if (v60 !== v3.cull_enable) {
      if (v60) {
       v8.enable(2884);
      }
      else {
       v8.disable(2884);
      }
      v3.cull_enable = v60;
     }
     v61 = v10.cull_face;
     if (v61 !== v3.cull_face) {
      v8.cullFace(v61);
      v3.cull_face = v61;
     }
     v62 = v10.frontFace;
     if (v62 !== v3.frontFace) {
      v8.frontFace(v62);
      v3.frontFace = v62;
     }
     v63 = v10.lineWidth;
     if (v63 !== v3.lineWidth) {
      v8.lineWidth(v63);
      v3.lineWidth = v63;
     }
     v64 = v10.polygonOffset_enable;
     if (v64 !== v3.polygonOffset_enable) {
      if (v64) {
       v8.enable(32823);
      }
      else {
       v8.disable(32823);
      }
      v3.polygonOffset_enable = v64;
     }
     v65 = v26[0];
     v66 = v26[1];
     if (v65 !== v27[0] || v66 !== v27[1]) {
      v8.polygonOffset(v65, v66);
      v27[0] = v65;
      v27[1] = v66;
     }
     v67 = v10.sample_alpha;
     if (v67 !== v3.sample_alpha) {
      if (v67) {
       v8.enable(32926);
      }
      else {
       v8.disable(32926);
      }
      v3.sample_alpha = v67;
     }
     v68 = v10.sample_enable;
     if (v68 !== v3.sample_enable) {
      if (v68) {
       v8.enable(32928);
      }
      else {
       v8.disable(32928);
      }
      v3.sample_enable = v68;
     }
     v69 = v28[0];
     v70 = v28[1];
     if (v69 !== v29[0] || v70 !== v29[1]) {
      v8.sampleCoverage(v69, v70);
      v29[0] = v69;
      v29[1] = v70;
     }
     v71 = v10.stencil_mask;
     if (v71 !== v3.stencil_mask) {
      v8.stencilMask(v71);
      v3.stencil_mask = v71;
     }
     v72 = v32[0];
     v73 = v32[1];
     v74 = v32[2];
     if (v72 !== v33[0] || v73 !== v33[1] || v74 !== v33[2]) {
      v8.stencilFunc(v72, v73, v74);
      v33[0] = v72;
      v33[1] = v73;
      v33[2] = v74;
     }
     v75 = v36[0];
     v76 = v36[1];
     v77 = v36[2];
     v78 = v36[3];
     if (v75 !== v37[0] || v76 !== v37[1] || v77 !== v37[2] || v78 !== v37[3]) {
      v8.stencilOpSeparate(v75, v76, v77, v78);
      v37[0] = v75;
      v37[1] = v76;
      v37[2] = v77;
      v37[3] = v78;
     }
     v79 = v34[0];
     v80 = v34[1];
     v81 = v34[2];
     v82 = v34[3];
     if (v79 !== v35[0] || v80 !== v35[1] || v81 !== v35[2] || v82 !== v35[3]) {
      v8.stencilOpSeparate(v79, v80, v81, v82);
      v35[0] = v79;
      v35[1] = v80;
      v35[2] = v81;
      v35[3] = v82;
     }
    }
    v83 = a0['viewport'];
    v84 = v83.x | 0;
    v85 = v83.y | 0;
    v86 = 'width' in v83 ? v83.width | 0 : (v2.framebufferWidth - v84);
    v87 = 'height' in v83 ? v83.height | 0 : (v2.framebufferHeight - v85);
    v88 = v2.viewportWidth;
    v2.viewportWidth = v86;
    v89 = v2.viewportHeight;
    v2.viewportHeight = v87;
    v8.viewport(v84, v85, v86, v87);
    v39[0] = v84;
    v39[1] = v85;
    v39[2] = v86;
    v39[3] = v87;
    v8.blendColor(0, 0, 0, 0);
    v17[0] = 0;
    v17[1] = 0;
    v17[2] = 0;
    v17[3] = 0;
    v8.enable(3042);
    v3.blend_enable = true;
    v8.blendEquationSeparate(32774, 32774);
    v19[0] = 32774;
    v19[1] = 32774;
    v8.blendFuncSeparate(770, 771, 773, 1);
    v21[0] = 770;
    v21[1] = 771;
    v21[2] = 773;
    v21[3] = 1;
    v8.disable(2929);
    v3.depth_enable = false;
    v90 = a0['viewport'];
    v91 = v90.x | 0;
    v92 = v90.y | 0;
    v93 = 'width' in v90 ? v90.width | 0 : (v2.framebufferWidth - v91);
    v94 = 'height' in v90 ? v90.height | 0 : (v2.framebufferHeight - v92);
    v8.scissor(v91, v92, v93, v94);
    v31[0] = v91;
    v31[1] = v92;
    v31[2] = v93;
    v31[3] = v94;
    v8.enable(3089);
    v3.scissor_enable = true;
    v8.disable(2960);
    v3.stencil_enable = false;
    v95 = v3.profile;
    if (v95) {
     v96 = performance.now();
     $1.count++;
    }
    v8.useProgram($2.program);
    v97 = v6.angle_instanced_arrays;
    v15.setVAO(null);
    v98 = a0['positionBuffer'];
    v47.buffer = v98;
    v99 = false;
    v100 = null;
    v101 = 0;
    v102 = false;
    v103 = 0;
    v104 = 0;
    v105 = 1;
    v106 = 0;
    v107 = 5126;
    v108 = 0;
    v109 = 0;
    v110 = 0;
    v111 = 0;
    if (v9(v47)) {
     v99 = true;
     v100 = v1.createStream(34962, v47);
     v107 = v100.dtype;
    }
    else {
     v100 = v1.getBuffer(v47);
     if (v100) {
      v107 = v100.dtype;
     }
     else if ('constant' in v47) {
      v105 = 2;
      if (typeof v47.constant === 'number') {
       v109 = v47.constant;
       v110 = v111 = v108 = 0;
      }
      else {
       v109 = v47.constant.length > 0 ? v47.constant[0] : 0;
       v110 = v47.constant.length > 1 ? v47.constant[1] : 0;
       v111 = v47.constant.length > 2 ? v47.constant[2] : 0;
       v108 = v47.constant.length > 3 ? v47.constant[3] : 0;
      }
     }
     else {
      if (v9(v47.buffer)) {
       v100 = v1.createStream(34962, v47.buffer);
      }
      else {
       v100 = v1.getBuffer(v47.buffer);
      }
      v107 = 'type' in v47 ? v43[v47.type] : v100.dtype;
      v102 = !!v47.normalized;
      v104 = v47.size | 0;
      v103 = v47.offset | 0;
      v106 = v47.stride | 0;
      v101 = v47.divisor | 0;
     }
    }
    v112 = position.location;
    v113 = v0[v112];
    if (v105 === 1) {
     if (!v113.buffer) {
      v8.enableVertexAttribArray(v112);
     }
     v114 = v104 || 2;
     if (v113.type !== v107 || v113.size !== v114 || v113.buffer !== v100 || v113.normalized !== v102 || v113.offset !== v103 || v113.stride !== v106) {
      v8.bindBuffer(34962, v100.buffer);
      v8.vertexAttribPointer(v112, v114, v107, v102, v106, v103);
      v113.type = v107;
      v113.size = v114;
      v113.buffer = v100;
      v113.normalized = v102;
      v113.offset = v103;
      v113.stride = v106;
     }
     if (v113.divisor !== v101) {
      v97.vertexAttribDivisorANGLE(v112, v101);
      v113.divisor = v101;
     }
    }
    else {
     if (v113.buffer) {
      v8.disableVertexAttribArray(v112);
      v113.buffer = null;
     }
     if (v113.x !== v109 || v113.y !== v110 || v113.z !== v111 || v113.w !== v108) {
      v8.vertexAttrib4f(v112, v109, v110, v111, v108);
      v113.x = v109;
      v113.y = v110;
      v113.z = v111;
      v113.w = v108;
     }
    }
    v115 = a0['positionFractBuffer'];
    v48.buffer = v115;
    v116 = false;
    v117 = null;
    v118 = 0;
    v119 = false;
    v120 = 0;
    v121 = 0;
    v122 = 1;
    v123 = 0;
    v124 = 5126;
    v125 = 0;
    v126 = 0;
    v127 = 0;
    v128 = 0;
    if (v9(v48)) {
     v116 = true;
     v117 = v1.createStream(34962, v48);
     v124 = v117.dtype;
    }
    else {
     v117 = v1.getBuffer(v48);
     if (v117) {
      v124 = v117.dtype;
     }
     else if ('constant' in v48) {
      v122 = 2;
      if (typeof v48.constant === 'number') {
       v126 = v48.constant;
       v127 = v128 = v125 = 0;
      }
      else {
       v126 = v48.constant.length > 0 ? v48.constant[0] : 0;
       v127 = v48.constant.length > 1 ? v48.constant[1] : 0;
       v128 = v48.constant.length > 2 ? v48.constant[2] : 0;
       v125 = v48.constant.length > 3 ? v48.constant[3] : 0;
      }
     }
     else {
      if (v9(v48.buffer)) {
       v117 = v1.createStream(34962, v48.buffer);
      }
      else {
       v117 = v1.getBuffer(v48.buffer);
      }
      v124 = 'type' in v48 ? v43[v48.type] : v117.dtype;
      v119 = !!v48.normalized;
      v121 = v48.size | 0;
      v120 = v48.offset | 0;
      v123 = v48.stride | 0;
      v118 = v48.divisor | 0;
     }
    }
    v129 = positionFract.location;
    v130 = v0[v129];
    if (v122 === 1) {
     if (!v130.buffer) {
      v8.enableVertexAttribArray(v129);
     }
     v131 = v121 || 2;
     if (v130.type !== v124 || v130.size !== v131 || v130.buffer !== v117 || v130.normalized !== v119 || v130.offset !== v120 || v130.stride !== v123) {
      v8.bindBuffer(34962, v117.buffer);
      v8.vertexAttribPointer(v129, v131, v124, v119, v123, v120);
      v130.type = v124;
      v130.size = v131;
      v130.buffer = v117;
      v130.normalized = v119;
      v130.offset = v120;
      v130.stride = v123;
     }
     if (v130.divisor !== v118) {
      v97.vertexAttribDivisorANGLE(v129, v118);
      v130.divisor = v118;
     }
    }
    else {
     if (v130.buffer) {
      v8.disableVertexAttribArray(v129);
      v130.buffer = null;
     }
     if (v130.x !== v126 || v130.y !== v127 || v130.z !== v128 || v130.w !== v125) {
      v8.vertexAttrib4f(v129, v126, v127, v128, v125);
      v130.x = v126;
      v130.y = v127;
      v130.z = v128;
      v130.w = v125;
     }
    }
    v132 = a0['fill'];
    v133 = v132[0];
    v134 = v132[1];
    v135 = v132[2];
    v136 = v132[3];
    v8.uniform4f(color.location, v133, v134, v135, v136);
    v137 = a0['scale'];
    v138 = v137[0];
    v139 = v137[1];
    v8.uniform2f(scale.location, v138, v139);
    v140 = a0['scaleFract'];
    v141 = v140[0];
    v142 = v140[1];
    v8.uniform2f(scaleFract.location, v141, v142);
    v143 = a0['translate'];
    v144 = v143[0];
    v145 = v143[1];
    v8.uniform2f(translate.location, v144, v145);
    v146 = a0['translateFract'];
    v147 = v146[0];
    v148 = v146[1];
    v8.uniform2f(translateFract.location, v147, v148);
    v149 = a0['id'];
    v8.uniform1f(id.location, v149);
    v150 = a0['opacity'];
    v8.uniform1f(opacity.location, v150);
    v151 = $3.call(this, v2, a0, 0);
    v152 = null;
    v153 = v9(v151);
    if (v153) {
     v152 = v5.createStream(v151);
    }
    else {
     v152 = v5.getElements(v151);
    }
    if (v152) v8.bindBuffer(34963, v152.buffer.buffer);
    v154 = v152 ? v152.vertCount : -1;
    if (v154) {
     v155 = v4.instances;
     if (v155 > 0) {
      if (v152) {
       v97.drawElementsInstancedANGLE(4, v154, v152.type, 0 << ((v152.type - 5121) >> 1), v155);
      }
      else {
       v97.drawArraysInstancedANGLE(4, 0, v154, v155);
      }
     }
     else if (v155 < 0) {
      if (v152) {
       v8.drawElements(4, v154, v152.type, 0 << ((v152.type - 5121) >> 1));
      }
      else {
       v8.drawArrays(4, 0, v154);
      }
     }
     v3.dirty = true;
     v15.setVAO(null);
     v2.viewportWidth = v88;
     v2.viewportHeight = v89;
     if (v95) {
      $1.cpuTime += performance.now() - v96;
     }
     if (v99) {
      v1.destroyStream(v100);
     }
     if (v116) {
      v1.destroyStream(v117);
     }
     if (v153) {
      v5.destroyStream(v152);
     }
    }
   }
   , 'scope': function (a0, a1, a2) {
    var v156, v157, v158, v159, v160, v161, v162, v163, v164, v165, v166, v167, v168, v169, v170, v171, v172, v173, v174, v175, v176, v177, v178, v179, v180, v181, v182, v183, v184, v185, v186, v187, v188, v189, v190, v191, v192, v193, v194, v195, v196, v197, v198, v199, v200, v201, v202, v203, v204, v205, v206, v207, v208, v209, v210, v211, v212, v213, v214, v215, v216, v217, v218, v219, v220, v221, v222, v223, v224, v225, v226, v227, v228, v229, v230, v231, v232, v233, v234, v235, v236, v237, v238, v239, v240, v241, v242, v243, v244, v245, v246, v247, v248, v249, v250, v251, v252, v253, v254, v255, v256, v257, v258, v259, v260, v261, v262, v263, v264, v265, v266, v267, v268, v269, v270, v271;
    v156 = a0['viewport'];
    v157 = v156.x | 0;
    v158 = v156.y | 0;
    v159 = 'width' in v156 ? v156.width | 0 : (v2.framebufferWidth - v157);
    v160 = 'height' in v156 ? v156.height | 0 : (v2.framebufferHeight - v158);
    v161 = v2.viewportWidth;
    v2.viewportWidth = v159;
    v162 = v2.viewportHeight;
    v2.viewportHeight = v160;
    v163 = v38[0];
    v38[0] = v157;
    v164 = v38[1];
    v38[1] = v158;
    v165 = v38[2];
    v38[2] = v159;
    v166 = v38[3];
    v38[3] = v160;
    v167 = v16[0];
    v16[0] = 0;
    v168 = v16[1];
    v16[1] = 0;
    v169 = v16[2];
    v16[2] = 0;
    v170 = v16[3];
    v16[3] = 0;
    v171 = v10.blend_enable;
    v10.blend_enable = true;
    v172 = v18[0];
    v18[0] = 32774;
    v173 = v18[1];
    v18[1] = 32774;
    v174 = v20[0];
    v20[0] = 770;
    v175 = v20[1];
    v20[1] = 771;
    v176 = v20[2];
    v20[2] = 773;
    v177 = v20[3];
    v20[3] = 1;
    v178 = v10.depth_enable;
    v10.depth_enable = false;
    v179 = a0['viewport'];
    v180 = v179.x | 0;
    v181 = v179.y | 0;
    v182 = 'width' in v179 ? v179.width | 0 : (v2.framebufferWidth - v180);
    v183 = 'height' in v179 ? v179.height | 0 : (v2.framebufferHeight - v181);
    v184 = v30[0];
    v30[0] = v180;
    v185 = v30[1];
    v30[1] = v181;
    v186 = v30[2];
    v30[2] = v182;
    v187 = v30[3];
    v30[3] = v183;
    v188 = v10.scissor_enable;
    v10.scissor_enable = true;
    v189 = v10.stencil_enable;
    v10.stencil_enable = false;
    v190 = v3.profile;
    if (v190) {
     v191 = performance.now();
     $1.count++;
    }
    v192 = $4.call(this, v2, a0, a2);
    v193 = null;
    v194 = v9(v192);
    if (v194) {
     v193 = v5.createStream(v192);
    }
    else {
     v193 = v5.getElements(v192);
    }
    v195 = v4.elements;
    v4.elements = v193;
    v196 = v4.offset;
    v4.offset = 0;
    v197 = v193 ? v193.vertCount : -1;
    v198 = v4.count;
    v4.count = v197;
    v199 = v4.primitive;
    v4.primitive = 4;
    v200 = a0['fill'];
    v201 = v14[14];
    v14[14] = v200;
    v202 = a0['id'];
    v203 = v14[31];
    v14[31] = v202;
    v204 = a0['opacity'];
    v205 = v14[10];
    v14[10] = v204;
    v206 = v2['pixelRatio'];
    v207 = v14[34];
    v14[34] = v206;
    v208 = a0['scale'];
    v209 = v14[6];
    v14[6] = v208;
    v210 = a0['scaleFract'];
    v211 = v14[7];
    v14[7] = v210;
    v212 = a0['translate'];
    v213 = v14[8];
    v14[8] = v212;
    v214 = a0['translateFract'];
    v215 = v14[9];
    v14[9] = v214;
    v216 = $5.call(this, v2, a0, a2);
    v217 = v14[3];
    v14[3] = v216;
    v218 = a0['positionBuffer'];
    v47.buffer = v218;
    v219 = false;
    v220 = null;
    v221 = 0;
    v222 = false;
    v223 = 0;
    v224 = 0;
    v225 = 1;
    v226 = 0;
    v227 = 5126;
    v228 = 0;
    v229 = 0;
    v230 = 0;
    v231 = 0;
    if (v9(v47)) {
     v219 = true;
     v220 = v1.createStream(34962, v47);
     v227 = v220.dtype;
    }
    else {
     v220 = v1.getBuffer(v47);
     if (v220) {
      v227 = v220.dtype;
     }
     else if ('constant' in v47) {
      v225 = 2;
      if (typeof v47.constant === 'number') {
       v229 = v47.constant;
       v230 = v231 = v228 = 0;
      }
      else {
       v229 = v47.constant.length > 0 ? v47.constant[0] : 0;
       v230 = v47.constant.length > 1 ? v47.constant[1] : 0;
       v231 = v47.constant.length > 2 ? v47.constant[2] : 0;
       v228 = v47.constant.length > 3 ? v47.constant[3] : 0;
      }
     }
     else {
      if (v9(v47.buffer)) {
       v220 = v1.createStream(34962, v47.buffer);
      }
      else {
       v220 = v1.getBuffer(v47.buffer);
      }
      v227 = 'type' in v47 ? v43[v47.type] : v220.dtype;
      v222 = !!v47.normalized;
      v224 = v47.size | 0;
      v223 = v47.offset | 0;
      v226 = v47.stride | 0;
      v221 = v47.divisor | 0;
     }
    }
    v232 = $6.buffer;
    $6.buffer = v220;
    v233 = $6.divisor;
    $6.divisor = v221;
    v234 = $6.normalized;
    $6.normalized = v222;
    v235 = $6.offset;
    $6.offset = v223;
    v236 = $6.size;
    $6.size = v224;
    v237 = $6.state;
    $6.state = v225;
    v238 = $6.stride;
    $6.stride = v226;
    v239 = $6.type;
    $6.type = v227;
    v240 = $6.w;
    $6.w = v228;
    v241 = $6.x;
    $6.x = v229;
    v242 = $6.y;
    $6.y = v230;
    v243 = $6.z;
    $6.z = v231;
    v244 = a0['positionFractBuffer'];
    v48.buffer = v244;
    v245 = false;
    v246 = null;
    v247 = 0;
    v248 = false;
    v249 = 0;
    v250 = 0;
    v251 = 1;
    v252 = 0;
    v253 = 5126;
    v254 = 0;
    v255 = 0;
    v256 = 0;
    v257 = 0;
    if (v9(v48)) {
     v245 = true;
     v246 = v1.createStream(34962, v48);
     v253 = v246.dtype;
    }
    else {
     v246 = v1.getBuffer(v48);
     if (v246) {
      v253 = v246.dtype;
     }
     else if ('constant' in v48) {
      v251 = 2;
      if (typeof v48.constant === 'number') {
       v255 = v48.constant;
       v256 = v257 = v254 = 0;
      }
      else {
       v255 = v48.constant.length > 0 ? v48.constant[0] : 0;
       v256 = v48.constant.length > 1 ? v48.constant[1] : 0;
       v257 = v48.constant.length > 2 ? v48.constant[2] : 0;
       v254 = v48.constant.length > 3 ? v48.constant[3] : 0;
      }
     }
     else {
      if (v9(v48.buffer)) {
       v246 = v1.createStream(34962, v48.buffer);
      }
      else {
       v246 = v1.getBuffer(v48.buffer);
      }
      v253 = 'type' in v48 ? v43[v48.type] : v246.dtype;
      v248 = !!v48.normalized;
      v250 = v48.size | 0;
      v249 = v48.offset | 0;
      v252 = v48.stride | 0;
      v247 = v48.divisor | 0;
     }
    }
    v258 = $7.buffer;
    $7.buffer = v246;
    v259 = $7.divisor;
    $7.divisor = v247;
    v260 = $7.normalized;
    $7.normalized = v248;
    v261 = $7.offset;
    $7.offset = v249;
    v262 = $7.size;
    $7.size = v250;
    v263 = $7.state;
    $7.state = v251;
    v264 = $7.stride;
    $7.stride = v252;
    v265 = $7.type;
    $7.type = v253;
    v266 = $7.w;
    $7.w = v254;
    v267 = $7.x;
    $7.x = v255;
    v268 = $7.y;
    $7.y = v256;
    v269 = $7.z;
    $7.z = v257;
    v270 = v11.vert;
    v11.vert = 42;
    v271 = v11.frag;
    v11.frag = 41;
    v3.dirty = true;
    a1(v2, a0, a2);
    v2.viewportWidth = v161;
    v2.viewportHeight = v162;
    v38[0] = v163;
    v38[1] = v164;
    v38[2] = v165;
    v38[3] = v166;
    v16[0] = v167;
    v16[1] = v168;
    v16[2] = v169;
    v16[3] = v170;
    v10.blend_enable = v171;
    v18[0] = v172;
    v18[1] = v173;
    v20[0] = v174;
    v20[1] = v175;
    v20[2] = v176;
    v20[3] = v177;
    v10.depth_enable = v178;
    v30[0] = v184;
    v30[1] = v185;
    v30[2] = v186;
    v30[3] = v187;
    v10.scissor_enable = v188;
    v10.stencil_enable = v189;
    if (v190) {
     $1.cpuTime += performance.now() - v191;
    }
    if (v194) {
     v5.destroyStream(v193);
    }
    v4.elements = v195;
    v4.offset = v196;
    v4.count = v198;
    v4.primitive = v199;
    v14[14] = v201;
    v14[31] = v203;
    v14[10] = v205;
    v14[34] = v207;
    v14[6] = v209;
    v14[7] = v211;
    v14[8] = v213;
    v14[9] = v215;
    v14[3] = v217;
    if (v219) {
     v1.destroyStream(v220);
    }
    $6.buffer = v232;
    $6.divisor = v233;
    $6.normalized = v234;
    $6.offset = v235;
    $6.size = v236;
    $6.state = v237;
    $6.stride = v238;
    $6.type = v239;
    $6.w = v240;
    $6.x = v241;
    $6.y = v242;
    $6.z = v243;
    if (v245) {
     v1.destroyStream(v246);
    }
    $7.buffer = v258;
    $7.divisor = v259;
    $7.normalized = v260;
    $7.offset = v261;
    $7.size = v262;
    $7.state = v263;
    $7.stride = v264;
    $7.type = v265;
    $7.w = v266;
    $7.x = v267;
    $7.y = v268;
    $7.z = v269;
    v11.vert = v270;
    v11.frag = v271;
    v3.dirty = true;
   }
   ,
  }

 },
 '$45,borderColorId,borderSize,colorId,constPointSize,isActive,markerTexture,opacity,paletteSize,paletteTexture,pixelRatio,scale,scaleFract,size,translate,translateFract,x,xFract,y,yFract': function ($0, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, borderColorId, borderSize, colorId, constPointSize, isActive, markerTexture, opacity, paletteSize, paletteTexture, pixelRatio, scale, scaleFract, size, translate, translateFract, x, xFract, y, yFract
 ) {
  'use strict';
  var v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15, v16, v17, v18, v19, v20, v21, v22, v23, v24, v25, v26, v27, v28, v29, v30, v31, v32, v33, v34, v35, v36, v37, v38, v39, v40, v41, v42, v43, v44, v45, v46;
  v0 = $0.attributes;
  v1 = $0.buffer;
  v2 = $0.context;
  v3 = $0.current;
  v4 = $0.draw;
  v5 = $0.elements;
  v6 = $0.extensions;
  v7 = $0.framebuffer;
  v8 = $0.gl;
  v9 = $0.isBufferArgs;
  v10 = $0.next;
  v11 = $0.shader;
  v12 = $0.strings;
  v13 = $0.timer;
  v14 = $0.uniforms;
  v15 = $0.vao;
  v16 = v10.blend_color;
  v17 = v3.blend_color;
  v18 = v10.blend_equation;
  v19 = v3.blend_equation;
  v20 = v10.blend_func;
  v21 = v3.blend_func;
  v22 = v10.colorMask;
  v23 = v3.colorMask;
  v24 = v10.depth_range;
  v25 = v3.depth_range;
  v26 = v10.polygonOffset_offset;
  v27 = v3.polygonOffset_offset;
  v28 = v10.sample_coverage;
  v29 = v3.sample_coverage;
  v30 = v10.scissor_box;
  v31 = v3.scissor_box;
  v32 = v10.stencil_func;
  v33 = v3.stencil_func;
  v34 = v10.stencil_opBack;
  v35 = v3.stencil_opBack;
  v36 = v10.stencil_opFront;
  v37 = v3.stencil_opFront;
  v38 = v10.viewport;
  v39 = v3.viewport;
  v40 = {
   'add': 32774, 'subtract': 32778, 'reverse subtract': 32779
  }
   ;
  v41 = {
   '0': 0, '1': 1, 'zero': 0, 'one': 1, 'src color': 768, 'one minus src color': 769, 'src alpha': 770, 'one minus src alpha': 771, 'dst color': 774, 'one minus dst color': 775, 'dst alpha': 772, 'one minus dst alpha': 773, 'constant color': 32769, 'one minus constant color': 32770, 'constant alpha': 32771, 'one minus constant alpha': 32772, 'src alpha saturate': 776
  }
   ;
  v42 = {
   'never': 512, 'less': 513, '<': 513, 'equal': 514, '=': 514, '==': 514, '===': 514, 'lequal': 515, '<=': 515, 'greater': 516, '>': 516, 'notequal': 517, '!=': 517, '!==': 517, 'gequal': 518, '>=': 518, 'always': 519
  }
   ;
  v43 = {
   'int8': 5120, 'int16': 5122, 'int32': 5124, 'uint8': 5121, 'uint16': 5123, 'uint32': 5125, 'float': 5126, 'float32': 5126
  }
   ;
  v44 = {
   'cw': 2304, 'ccw': 2305
  }
   ;
  v45 = {
   'points': 0, 'point': 0, 'lines': 1, 'line': 1, 'triangles': 4, 'triangle': 4, 'line loop': 2, 'line strip': 3, 'triangle strip': 5, 'triangle fan': 6
  }
   ;
  v46 = {
   '0': 0, 'zero': 0, 'keep': 7680, 'replace': 7681, 'increment': 7682, 'decrement': 7683, 'increment wrap': 34055, 'decrement wrap': 34056, 'invert': 5386
  }
   ;
  return {
   'batch': function (a0, a1) {
    var v573, v574, v609, v610, v611, v612, v613;
    v573 = v6.angle_instanced_arrays;
    v574 = v7.next;
    if (v574 !== v7.cur) {
     if (v574) {
      v8.bindFramebuffer(36160, v574.framebuffer);
     }
     else {
      v8.bindFramebuffer(36160, null);
     }
     v7.cur = v574;
    }
    if (v3.dirty) {
     var v575, v576, v577, v578, v579, v580, v581, v582, v583, v584, v585, v586, v587, v588, v589, v590, v591, v592, v593, v594, v595, v596, v597, v598, v599, v600, v601, v602, v603, v604, v605, v606, v607, v608;
     v575 = v10.dither;
     if (v575 !== v3.dither) {
      if (v575) {
       v8.enable(3024);
      }
      else {
       v8.disable(3024);
      }
      v3.dither = v575;
     }
     v576 = v18[0];
     v577 = v18[1];
     if (v576 !== v19[0] || v577 !== v19[1]) {
      v8.blendEquationSeparate(v576, v577);
      v19[0] = v576;
      v19[1] = v577;
     }
     v578 = v10.depth_func;
     if (v578 !== v3.depth_func) {
      v8.depthFunc(v578);
      v3.depth_func = v578;
     }
     v579 = v24[0];
     v580 = v24[1];
     if (v579 !== v25[0] || v580 !== v25[1]) {
      v8.depthRange(v579, v580);
      v25[0] = v579;
      v25[1] = v580;
     }
     v581 = v10.depth_mask;
     if (v581 !== v3.depth_mask) {
      v8.depthMask(v581);
      v3.depth_mask = v581;
     }
     v582 = v22[0];
     v583 = v22[1];
     v584 = v22[2];
     v585 = v22[3];
     if (v582 !== v23[0] || v583 !== v23[1] || v584 !== v23[2] || v585 !== v23[3]) {
      v8.colorMask(v582, v583, v584, v585);
      v23[0] = v582;
      v23[1] = v583;
      v23[2] = v584;
      v23[3] = v585;
     }
     v586 = v10.cull_enable;
     if (v586 !== v3.cull_enable) {
      if (v586) {
       v8.enable(2884);
      }
      else {
       v8.disable(2884);
      }
      v3.cull_enable = v586;
     }
     v587 = v10.cull_face;
     if (v587 !== v3.cull_face) {
      v8.cullFace(v587);
      v3.cull_face = v587;
     }
     v588 = v10.frontFace;
     if (v588 !== v3.frontFace) {
      v8.frontFace(v588);
      v3.frontFace = v588;
     }
     v589 = v10.lineWidth;
     if (v589 !== v3.lineWidth) {
      v8.lineWidth(v589);
      v3.lineWidth = v589;
     }
     v590 = v10.polygonOffset_enable;
     if (v590 !== v3.polygonOffset_enable) {
      if (v590) {
       v8.enable(32823);
      }
      else {
       v8.disable(32823);
      }
      v3.polygonOffset_enable = v590;
     }
     v591 = v26[0];
     v592 = v26[1];
     if (v591 !== v27[0] || v592 !== v27[1]) {
      v8.polygonOffset(v591, v592);
      v27[0] = v591;
      v27[1] = v592;
     }
     v593 = v10.sample_alpha;
     if (v593 !== v3.sample_alpha) {
      if (v593) {
       v8.enable(32926);
      }
      else {
       v8.disable(32926);
      }
      v3.sample_alpha = v593;
     }
     v594 = v10.sample_enable;
     if (v594 !== v3.sample_enable) {
      if (v594) {
       v8.enable(32928);
      }
      else {
       v8.disable(32928);
      }
      v3.sample_enable = v594;
     }
     v595 = v28[0];
     v596 = v28[1];
     if (v595 !== v29[0] || v596 !== v29[1]) {
      v8.sampleCoverage(v595, v596);
      v29[0] = v595;
      v29[1] = v596;
     }
     v597 = v10.stencil_mask;
     if (v597 !== v3.stencil_mask) {
      v8.stencilMask(v597);
      v3.stencil_mask = v597;
     }
     v598 = v32[0];
     v599 = v32[1];
     v600 = v32[2];
     if (v598 !== v33[0] || v599 !== v33[1] || v600 !== v33[2]) {
      v8.stencilFunc(v598, v599, v600);
      v33[0] = v598;
      v33[1] = v599;
      v33[2] = v600;
     }
     v601 = v36[0];
     v602 = v36[1];
     v603 = v36[2];
     v604 = v36[3];
     if (v601 !== v37[0] || v602 !== v37[1] || v603 !== v37[2] || v604 !== v37[3]) {
      v8.stencilOpSeparate(v601, v602, v603, v604);
      v37[0] = v601;
      v37[1] = v602;
      v37[2] = v603;
      v37[3] = v604;
     }
     v605 = v34[0];
     v606 = v34[1];
     v607 = v34[2];
     v608 = v34[3];
     if (v605 !== v35[0] || v606 !== v35[1] || v607 !== v35[2] || v608 !== v35[3]) {
      v8.stencilOpSeparate(v605, v606, v607, v608);
      v35[0] = v605;
      v35[1] = v606;
      v35[2] = v607;
      v35[3] = v608;
     }
    }
    v8.blendColor(0, 0, 0, 1);
    v17[0] = 0;
    v17[1] = 0;
    v17[2] = 0;
    v17[3] = 1;
    v8.enable(3042);
    v3.blend_enable = true;
    v8.blendFuncSeparate(770, 771, 773, 1);
    v21[0] = 770;
    v21[1] = 771;
    v21[2] = 773;
    v21[3] = 1;
    v8.disable(2929);
    v3.depth_enable = false;
    v8.enable(3089);
    v3.scissor_enable = true;
    v8.disable(2960);
    v3.stencil_enable = false;
    v609 = v3.profile;
    if (v609) {
     v610 = performance.now();
     $1.count += a1;
    }
    v8.useProgram($34.program);
    v611 = v6.angle_instanced_arrays;
    var v815;
    v15.setVAO(null);
    v8.uniform1i(constPointSize.location, false);
    v8.uniform1i(paletteTexture.location, $44.bind());
    v815 = v4.instances;
    for (v612 = 0;
     v612 < a1;
     ++v612) {
     v613 = a0[v612];
     var v614, v615, v616, v617, v618, v619, v620, v621, v622, v623, v624, v625, v626, v627, v628, v629, v630, v631, v632, v633, v634, v635, v636, v637, v638, v639, v640, v641, v642, v643, v644, v645, v646, v647, v648, v649, v650, v651, v652, v653, v654, v655, v656, v657, v658, v659, v660, v661, v662, v663, v664, v665, v666, v667, v668, v669, v670, v671, v672, v673, v674, v675, v676, v677, v678, v679, v680, v681, v682, v683, v684, v685, v686, v687, v688, v689, v690, v691, v692, v693, v694, v695, v696, v697, v698, v699, v700, v701, v702, v703, v704, v705, v706, v707, v708, v709, v710, v711, v712, v713, v714, v715, v716, v717, v718, v719, v720, v721, v722, v723, v724, v725, v726, v727, v728, v729, v730, v731, v732, v733, v734, v735, v736, v737, v738, v739, v740, v741, v742, v743, v744, v745, v746, v747, v748, v749, v750, v751, v752, v753, v754, v755, v756, v757, v758, v759, v760, v761, v762, v763, v764, v765, v766, v767, v768, v769, v770, v771, v772, v773, v774, v775, v776, v777, v778, v779, v780, v781, v782, v783, v784, v785, v786, v787, v788, v789, v790, v791, v792, v793, v794, v795, v796, v797, v798, v799, v800, v801, v802, v803, v804, v805, v806, v807, v808, v809, v810, v811, v812, v813, v814;
     v614 = v613['viewport'];
     v615 = v614.x | 0;
     v616 = v614.y | 0;
     v617 = 'width' in v614 ? v614.width | 0 : (v2.framebufferWidth - v615);
     v618 = 'height' in v614 ? v614.height | 0 : (v2.framebufferHeight - v616);
     v619 = v2.viewportWidth;
     v2.viewportWidth = v617;
     v620 = v2.viewportHeight;
     v2.viewportHeight = v618;
     v8.viewport(v615, v616, v617, v618);
     v39[0] = v615;
     v39[1] = v616;
     v39[2] = v617;
     v39[3] = v618;
     v621 = v613['viewport'];
     v622 = v621.x | 0;
     v623 = v621.y | 0;
     v624 = 'width' in v621 ? v621.width | 0 : (v2.framebufferWidth - v622);
     v625 = 'height' in v621 ? v621.height | 0 : (v2.framebufferHeight - v623);
     v8.scissor(v622, v623, v624, v625);
     v31[0] = v622;
     v31[1] = v623;
     v31[2] = v624;
     v31[3] = v625;
     v626 = $35.call(this, v2, v613, v612);
     v627 = false;
     v628 = null;
     v629 = 0;
     v630 = false;
     v631 = 0;
     v632 = 0;
     v633 = 1;
     v634 = 0;
     v635 = 5126;
     v636 = 0;
     v637 = 0;
     v638 = 0;
     v639 = 0;
     if (v9(v626)) {
      v627 = true;
      v628 = v1.createStream(34962, v626);
      v635 = v628.dtype;
     }
     else {
      v628 = v1.getBuffer(v626);
      if (v628) {
       v635 = v628.dtype;
      }
      else if ('constant' in v626) {
       v633 = 2;
       if (typeof v626.constant === 'number') {
        v637 = v626.constant;
        v638 = v639 = v636 = 0;
       }
       else {
        v637 = v626.constant.length > 0 ? v626.constant[0] : 0;
        v638 = v626.constant.length > 1 ? v626.constant[1] : 0;
        v639 = v626.constant.length > 2 ? v626.constant[2] : 0;
        v636 = v626.constant.length > 3 ? v626.constant[3] : 0;
       }
      }
      else {
       if (v9(v626.buffer)) {
        v628 = v1.createStream(34962, v626.buffer);
       }
       else {
        v628 = v1.getBuffer(v626.buffer);
       }
       v635 = 'type' in v626 ? v43[v626.type] : v628.dtype;
       v630 = !!v626.normalized;
       v632 = v626.size | 0;
       v631 = v626.offset | 0;
       v634 = v626.stride | 0;
       v629 = v626.divisor | 0;
      }
     }
     v640 = x.location;
     v641 = v0[v640];
     if (v633 === 1) {
      if (!v641.buffer) {
       v8.enableVertexAttribArray(v640);
      }
      v642 = v632 || 1;
      if (v641.type !== v635 || v641.size !== v642 || v641.buffer !== v628 || v641.normalized !== v630 || v641.offset !== v631 || v641.stride !== v634) {
       v8.bindBuffer(34962, v628.buffer);
       v8.vertexAttribPointer(v640, v642, v635, v630, v634, v631);
       v641.type = v635;
       v641.size = v642;
       v641.buffer = v628;
       v641.normalized = v630;
       v641.offset = v631;
       v641.stride = v634;
      }
      if (v641.divisor !== v629) {
       v611.vertexAttribDivisorANGLE(v640, v629);
       v641.divisor = v629;
      }
     }
     else {
      if (v641.buffer) {
       v8.disableVertexAttribArray(v640);
       v641.buffer = null;
      }
      if (v641.x !== v637 || v641.y !== v638 || v641.z !== v639 || v641.w !== v636) {
       v8.vertexAttrib4f(v640, v637, v638, v639, v636);
       v641.x = v637;
       v641.y = v638;
       v641.z = v639;
       v641.w = v636;
      }
     }
     v643 = $36.call(this, v2, v613, v612);
     v644 = false;
     v645 = null;
     v646 = 0;
     v647 = false;
     v648 = 0;
     v649 = 0;
     v650 = 1;
     v651 = 0;
     v652 = 5126;
     v653 = 0;
     v654 = 0;
     v655 = 0;
     v656 = 0;
     if (v9(v643)) {
      v644 = true;
      v645 = v1.createStream(34962, v643);
      v652 = v645.dtype;
     }
     else {
      v645 = v1.getBuffer(v643);
      if (v645) {
       v652 = v645.dtype;
      }
      else if ('constant' in v643) {
       v650 = 2;
       if (typeof v643.constant === 'number') {
        v654 = v643.constant;
        v655 = v656 = v653 = 0;
       }
       else {
        v654 = v643.constant.length > 0 ? v643.constant[0] : 0;
        v655 = v643.constant.length > 1 ? v643.constant[1] : 0;
        v656 = v643.constant.length > 2 ? v643.constant[2] : 0;
        v653 = v643.constant.length > 3 ? v643.constant[3] : 0;
       }
      }
      else {
       if (v9(v643.buffer)) {
        v645 = v1.createStream(34962, v643.buffer);
       }
       else {
        v645 = v1.getBuffer(v643.buffer);
       }
       v652 = 'type' in v643 ? v43[v643.type] : v645.dtype;
       v647 = !!v643.normalized;
       v649 = v643.size | 0;
       v648 = v643.offset | 0;
       v651 = v643.stride | 0;
       v646 = v643.divisor | 0;
      }
     }
     v657 = y.location;
     v658 = v0[v657];
     if (v650 === 1) {
      if (!v658.buffer) {
       v8.enableVertexAttribArray(v657);
      }
      v659 = v649 || 1;
      if (v658.type !== v652 || v658.size !== v659 || v658.buffer !== v645 || v658.normalized !== v647 || v658.offset !== v648 || v658.stride !== v651) {
       v8.bindBuffer(34962, v645.buffer);
       v8.vertexAttribPointer(v657, v659, v652, v647, v651, v648);
       v658.type = v652;
       v658.size = v659;
       v658.buffer = v645;
       v658.normalized = v647;
       v658.offset = v648;
       v658.stride = v651;
      }
      if (v658.divisor !== v646) {
       v611.vertexAttribDivisorANGLE(v657, v646);
       v658.divisor = v646;
      }
     }
     else {
      if (v658.buffer) {
       v8.disableVertexAttribArray(v657);
       v658.buffer = null;
      }
      if (v658.x !== v654 || v658.y !== v655 || v658.z !== v656 || v658.w !== v653) {
       v8.vertexAttrib4f(v657, v654, v655, v656, v653);
       v658.x = v654;
       v658.y = v655;
       v658.z = v656;
       v658.w = v653;
      }
     }
     v660 = $37.call(this, v2, v613, v612);
     v661 = false;
     v662 = null;
     v663 = 0;
     v664 = false;
     v665 = 0;
     v666 = 0;
     v667 = 1;
     v668 = 0;
     v669 = 5126;
     v670 = 0;
     v671 = 0;
     v672 = 0;
     v673 = 0;
     if (v9(v660)) {
      v661 = true;
      v662 = v1.createStream(34962, v660);
      v669 = v662.dtype;
     }
     else {
      v662 = v1.getBuffer(v660);
      if (v662) {
       v669 = v662.dtype;
      }
      else if ('constant' in v660) {
       v667 = 2;
       if (typeof v660.constant === 'number') {
        v671 = v660.constant;
        v672 = v673 = v670 = 0;
       }
       else {
        v671 = v660.constant.length > 0 ? v660.constant[0] : 0;
        v672 = v660.constant.length > 1 ? v660.constant[1] : 0;
        v673 = v660.constant.length > 2 ? v660.constant[2] : 0;
        v670 = v660.constant.length > 3 ? v660.constant[3] : 0;
       }
      }
      else {
       if (v9(v660.buffer)) {
        v662 = v1.createStream(34962, v660.buffer);
       }
       else {
        v662 = v1.getBuffer(v660.buffer);
       }
       v669 = 'type' in v660 ? v43[v660.type] : v662.dtype;
       v664 = !!v660.normalized;
       v666 = v660.size | 0;
       v665 = v660.offset | 0;
       v668 = v660.stride | 0;
       v663 = v660.divisor | 0;
      }
     }
     v674 = xFract.location;
     v675 = v0[v674];
     if (v667 === 1) {
      if (!v675.buffer) {
       v8.enableVertexAttribArray(v674);
      }
      v676 = v666 || 1;
      if (v675.type !== v669 || v675.size !== v676 || v675.buffer !== v662 || v675.normalized !== v664 || v675.offset !== v665 || v675.stride !== v668) {
       v8.bindBuffer(34962, v662.buffer);
       v8.vertexAttribPointer(v674, v676, v669, v664, v668, v665);
       v675.type = v669;
       v675.size = v676;
       v675.buffer = v662;
       v675.normalized = v664;
       v675.offset = v665;
       v675.stride = v668;
      }
      if (v675.divisor !== v663) {
       v611.vertexAttribDivisorANGLE(v674, v663);
       v675.divisor = v663;
      }
     }
     else {
      if (v675.buffer) {
       v8.disableVertexAttribArray(v674);
       v675.buffer = null;
      }
      if (v675.x !== v671 || v675.y !== v672 || v675.z !== v673 || v675.w !== v670) {
       v8.vertexAttrib4f(v674, v671, v672, v673, v670);
       v675.x = v671;
       v675.y = v672;
       v675.z = v673;
       v675.w = v670;
      }
     }
     v677 = $38.call(this, v2, v613, v612);
     v678 = false;
     v679 = null;
     v680 = 0;
     v681 = false;
     v682 = 0;
     v683 = 0;
     v684 = 1;
     v685 = 0;
     v686 = 5126;
     v687 = 0;
     v688 = 0;
     v689 = 0;
     v690 = 0;
     if (v9(v677)) {
      v678 = true;
      v679 = v1.createStream(34962, v677);
      v686 = v679.dtype;
     }
     else {
      v679 = v1.getBuffer(v677);
      if (v679) {
       v686 = v679.dtype;
      }
      else if ('constant' in v677) {
       v684 = 2;
       if (typeof v677.constant === 'number') {
        v688 = v677.constant;
        v689 = v690 = v687 = 0;
       }
       else {
        v688 = v677.constant.length > 0 ? v677.constant[0] : 0;
        v689 = v677.constant.length > 1 ? v677.constant[1] : 0;
        v690 = v677.constant.length > 2 ? v677.constant[2] : 0;
        v687 = v677.constant.length > 3 ? v677.constant[3] : 0;
       }
      }
      else {
       if (v9(v677.buffer)) {
        v679 = v1.createStream(34962, v677.buffer);
       }
       else {
        v679 = v1.getBuffer(v677.buffer);
       }
       v686 = 'type' in v677 ? v43[v677.type] : v679.dtype;
       v681 = !!v677.normalized;
       v683 = v677.size | 0;
       v682 = v677.offset | 0;
       v685 = v677.stride | 0;
       v680 = v677.divisor | 0;
      }
     }
     v691 = yFract.location;
     v692 = v0[v691];
     if (v684 === 1) {
      if (!v692.buffer) {
       v8.enableVertexAttribArray(v691);
      }
      v693 = v683 || 1;
      if (v692.type !== v686 || v692.size !== v693 || v692.buffer !== v679 || v692.normalized !== v681 || v692.offset !== v682 || v692.stride !== v685) {
       v8.bindBuffer(34962, v679.buffer);
       v8.vertexAttribPointer(v691, v693, v686, v681, v685, v682);
       v692.type = v686;
       v692.size = v693;
       v692.buffer = v679;
       v692.normalized = v681;
       v692.offset = v682;
       v692.stride = v685;
      }
      if (v692.divisor !== v680) {
       v611.vertexAttribDivisorANGLE(v691, v680);
       v692.divisor = v680;
      }
     }
     else {
      if (v692.buffer) {
       v8.disableVertexAttribArray(v691);
       v692.buffer = null;
      }
      if (v692.x !== v688 || v692.y !== v689 || v692.z !== v690 || v692.w !== v687) {
       v8.vertexAttrib4f(v691, v688, v689, v690, v687);
       v692.x = v688;
       v692.y = v689;
       v692.z = v690;
       v692.w = v687;
      }
     }
     v694 = $39.call(this, v2, v613, v612);
     v695 = false;
     v696 = null;
     v697 = 0;
     v698 = false;
     v699 = 0;
     v700 = 0;
     v701 = 1;
     v702 = 0;
     v703 = 5126;
     v704 = 0;
     v705 = 0;
     v706 = 0;
     v707 = 0;
     if (v9(v694)) {
      v695 = true;
      v696 = v1.createStream(34962, v694);
      v703 = v696.dtype;
     }
     else {
      v696 = v1.getBuffer(v694);
      if (v696) {
       v703 = v696.dtype;
      }
      else if ('constant' in v694) {
       v701 = 2;
       if (typeof v694.constant === 'number') {
        v705 = v694.constant;
        v706 = v707 = v704 = 0;
       }
       else {
        v705 = v694.constant.length > 0 ? v694.constant[0] : 0;
        v706 = v694.constant.length > 1 ? v694.constant[1] : 0;
        v707 = v694.constant.length > 2 ? v694.constant[2] : 0;
        v704 = v694.constant.length > 3 ? v694.constant[3] : 0;
       }
      }
      else {
       if (v9(v694.buffer)) {
        v696 = v1.createStream(34962, v694.buffer);
       }
       else {
        v696 = v1.getBuffer(v694.buffer);
       }
       v703 = 'type' in v694 ? v43[v694.type] : v696.dtype;
       v698 = !!v694.normalized;
       v700 = v694.size | 0;
       v699 = v694.offset | 0;
       v702 = v694.stride | 0;
       v697 = v694.divisor | 0;
      }
     }
     v708 = size.location;
     v709 = v0[v708];
     if (v701 === 1) {
      if (!v709.buffer) {
       v8.enableVertexAttribArray(v708);
      }
      v710 = v700 || 1;
      if (v709.type !== v703 || v709.size !== v710 || v709.buffer !== v696 || v709.normalized !== v698 || v709.offset !== v699 || v709.stride !== v702) {
       v8.bindBuffer(34962, v696.buffer);
       v8.vertexAttribPointer(v708, v710, v703, v698, v702, v699);
       v709.type = v703;
       v709.size = v710;
       v709.buffer = v696;
       v709.normalized = v698;
       v709.offset = v699;
       v709.stride = v702;
      }
      if (v709.divisor !== v697) {
       v611.vertexAttribDivisorANGLE(v708, v697);
       v709.divisor = v697;
      }
     }
     else {
      if (v709.buffer) {
       v8.disableVertexAttribArray(v708);
       v709.buffer = null;
      }
      if (v709.x !== v705 || v709.y !== v706 || v709.z !== v707 || v709.w !== v704) {
       v8.vertexAttrib4f(v708, v705, v706, v707, v704);
       v709.x = v705;
       v709.y = v706;
       v709.z = v707;
       v709.w = v704;
      }
     }
     v711 = $40.call(this, v2, v613, v612);
     v712 = false;
     v713 = null;
     v714 = 0;
     v715 = false;
     v716 = 0;
     v717 = 0;
     v718 = 1;
     v719 = 0;
     v720 = 5126;
     v721 = 0;
     v722 = 0;
     v723 = 0;
     v724 = 0;
     if (v9(v711)) {
      v712 = true;
      v713 = v1.createStream(34962, v711);
      v720 = v713.dtype;
     }
     else {
      v713 = v1.getBuffer(v711);
      if (v713) {
       v720 = v713.dtype;
      }
      else if ('constant' in v711) {
       v718 = 2;
       if (typeof v711.constant === 'number') {
        v722 = v711.constant;
        v723 = v724 = v721 = 0;
       }
       else {
        v722 = v711.constant.length > 0 ? v711.constant[0] : 0;
        v723 = v711.constant.length > 1 ? v711.constant[1] : 0;
        v724 = v711.constant.length > 2 ? v711.constant[2] : 0;
        v721 = v711.constant.length > 3 ? v711.constant[3] : 0;
       }
      }
      else {
       if (v9(v711.buffer)) {
        v713 = v1.createStream(34962, v711.buffer);
       }
       else {
        v713 = v1.getBuffer(v711.buffer);
       }
       v720 = 'type' in v711 ? v43[v711.type] : v713.dtype;
       v715 = !!v711.normalized;
       v717 = v711.size | 0;
       v716 = v711.offset | 0;
       v719 = v711.stride | 0;
       v714 = v711.divisor | 0;
      }
     }
     v725 = borderSize.location;
     v726 = v0[v725];
     if (v718 === 1) {
      if (!v726.buffer) {
       v8.enableVertexAttribArray(v725);
      }
      v727 = v717 || 1;
      if (v726.type !== v720 || v726.size !== v727 || v726.buffer !== v713 || v726.normalized !== v715 || v726.offset !== v716 || v726.stride !== v719) {
       v8.bindBuffer(34962, v713.buffer);
       v8.vertexAttribPointer(v725, v727, v720, v715, v719, v716);
       v726.type = v720;
       v726.size = v727;
       v726.buffer = v713;
       v726.normalized = v715;
       v726.offset = v716;
       v726.stride = v719;
      }
      if (v726.divisor !== v714) {
       v611.vertexAttribDivisorANGLE(v725, v714);
       v726.divisor = v714;
      }
     }
     else {
      if (v726.buffer) {
       v8.disableVertexAttribArray(v725);
       v726.buffer = null;
      }
      if (v726.x !== v722 || v726.y !== v723 || v726.z !== v724 || v726.w !== v721) {
       v8.vertexAttrib4f(v725, v722, v723, v724, v721);
       v726.x = v722;
       v726.y = v723;
       v726.z = v724;
       v726.w = v721;
      }
     }
     v728 = $41.call(this, v2, v613, v612);
     v729 = false;
     v730 = null;
     v731 = 0;
     v732 = false;
     v733 = 0;
     v734 = 0;
     v735 = 1;
     v736 = 0;
     v737 = 5126;
     v738 = 0;
     v739 = 0;
     v740 = 0;
     v741 = 0;
     if (v9(v728)) {
      v729 = true;
      v730 = v1.createStream(34962, v728);
      v737 = v730.dtype;
     }
     else {
      v730 = v1.getBuffer(v728);
      if (v730) {
       v737 = v730.dtype;
      }
      else if ('constant' in v728) {
       v735 = 2;
       if (typeof v728.constant === 'number') {
        v739 = v728.constant;
        v740 = v741 = v738 = 0;
       }
       else {
        v739 = v728.constant.length > 0 ? v728.constant[0] : 0;
        v740 = v728.constant.length > 1 ? v728.constant[1] : 0;
        v741 = v728.constant.length > 2 ? v728.constant[2] : 0;
        v738 = v728.constant.length > 3 ? v728.constant[3] : 0;
       }
      }
      else {
       if (v9(v728.buffer)) {
        v730 = v1.createStream(34962, v728.buffer);
       }
       else {
        v730 = v1.getBuffer(v728.buffer);
       }
       v737 = 'type' in v728 ? v43[v728.type] : v730.dtype;
       v732 = !!v728.normalized;
       v734 = v728.size | 0;
       v733 = v728.offset | 0;
       v736 = v728.stride | 0;
       v731 = v728.divisor | 0;
      }
     }
     v742 = colorId.location;
     v743 = v0[v742];
     if (v735 === 1) {
      if (!v743.buffer) {
       v8.enableVertexAttribArray(v742);
      }
      v744 = v734 || 4;
      if (v743.type !== v737 || v743.size !== v744 || v743.buffer !== v730 || v743.normalized !== v732 || v743.offset !== v733 || v743.stride !== v736) {
       v8.bindBuffer(34962, v730.buffer);
       v8.vertexAttribPointer(v742, v744, v737, v732, v736, v733);
       v743.type = v737;
       v743.size = v744;
       v743.buffer = v730;
       v743.normalized = v732;
       v743.offset = v733;
       v743.stride = v736;
      }
      if (v743.divisor !== v731) {
       v611.vertexAttribDivisorANGLE(v742, v731);
       v743.divisor = v731;
      }
     }
     else {
      if (v743.buffer) {
       v8.disableVertexAttribArray(v742);
       v743.buffer = null;
      }
      if (v743.x !== v739 || v743.y !== v740 || v743.z !== v741 || v743.w !== v738) {
       v8.vertexAttrib4f(v742, v739, v740, v741, v738);
       v743.x = v739;
       v743.y = v740;
       v743.z = v741;
       v743.w = v738;
      }
     }
     v745 = $42.call(this, v2, v613, v612);
     v746 = false;
     v747 = null;
     v748 = 0;
     v749 = false;
     v750 = 0;
     v751 = 0;
     v752 = 1;
     v753 = 0;
     v754 = 5126;
     v755 = 0;
     v756 = 0;
     v757 = 0;
     v758 = 0;
     if (v9(v745)) {
      v746 = true;
      v747 = v1.createStream(34962, v745);
      v754 = v747.dtype;
     }
     else {
      v747 = v1.getBuffer(v745);
      if (v747) {
       v754 = v747.dtype;
      }
      else if ('constant' in v745) {
       v752 = 2;
       if (typeof v745.constant === 'number') {
        v756 = v745.constant;
        v757 = v758 = v755 = 0;
       }
       else {
        v756 = v745.constant.length > 0 ? v745.constant[0] : 0;
        v757 = v745.constant.length > 1 ? v745.constant[1] : 0;
        v758 = v745.constant.length > 2 ? v745.constant[2] : 0;
        v755 = v745.constant.length > 3 ? v745.constant[3] : 0;
       }
      }
      else {
       if (v9(v745.buffer)) {
        v747 = v1.createStream(34962, v745.buffer);
       }
       else {
        v747 = v1.getBuffer(v745.buffer);
       }
       v754 = 'type' in v745 ? v43[v745.type] : v747.dtype;
       v749 = !!v745.normalized;
       v751 = v745.size | 0;
       v750 = v745.offset | 0;
       v753 = v745.stride | 0;
       v748 = v745.divisor | 0;
      }
     }
     v759 = borderColorId.location;
     v760 = v0[v759];
     if (v752 === 1) {
      if (!v760.buffer) {
       v8.enableVertexAttribArray(v759);
      }
      v761 = v751 || 4;
      if (v760.type !== v754 || v760.size !== v761 || v760.buffer !== v747 || v760.normalized !== v749 || v760.offset !== v750 || v760.stride !== v753) {
       v8.bindBuffer(34962, v747.buffer);
       v8.vertexAttribPointer(v759, v761, v754, v749, v753, v750);
       v760.type = v754;
       v760.size = v761;
       v760.buffer = v747;
       v760.normalized = v749;
       v760.offset = v750;
       v760.stride = v753;
      }
      if (v760.divisor !== v748) {
       v611.vertexAttribDivisorANGLE(v759, v748);
       v760.divisor = v748;
      }
     }
     else {
      if (v760.buffer) {
       v8.disableVertexAttribArray(v759);
       v760.buffer = null;
      }
      if (v760.x !== v756 || v760.y !== v757 || v760.z !== v758 || v760.w !== v755) {
       v8.vertexAttrib4f(v759, v756, v757, v758, v755);
       v760.x = v756;
       v760.y = v757;
       v760.z = v758;
       v760.w = v755;
      }
     }
     v762 = $43.call(this, v2, v613, v612);
     v763 = false;
     v764 = null;
     v765 = 0;
     v766 = false;
     v767 = 0;
     v768 = 0;
     v769 = 1;
     v770 = 0;
     v771 = 5126;
     v772 = 0;
     v773 = 0;
     v774 = 0;
     v775 = 0;
     if (v9(v762)) {
      v763 = true;
      v764 = v1.createStream(34962, v762);
      v771 = v764.dtype;
     }
     else {
      v764 = v1.getBuffer(v762);
      if (v764) {
       v771 = v764.dtype;
      }
      else if ('constant' in v762) {
       v769 = 2;
       if (typeof v762.constant === 'number') {
        v773 = v762.constant;
        v774 = v775 = v772 = 0;
       }
       else {
        v773 = v762.constant.length > 0 ? v762.constant[0] : 0;
        v774 = v762.constant.length > 1 ? v762.constant[1] : 0;
        v775 = v762.constant.length > 2 ? v762.constant[2] : 0;
        v772 = v762.constant.length > 3 ? v762.constant[3] : 0;
       }
      }
      else {
       if (v9(v762.buffer)) {
        v764 = v1.createStream(34962, v762.buffer);
       }
       else {
        v764 = v1.getBuffer(v762.buffer);
       }
       v771 = 'type' in v762 ? v43[v762.type] : v764.dtype;
       v766 = !!v762.normalized;
       v768 = v762.size | 0;
       v767 = v762.offset | 0;
       v770 = v762.stride | 0;
       v765 = v762.divisor | 0;
      }
     }
     v776 = isActive.location;
     v777 = v0[v776];
     if (v769 === 1) {
      if (!v777.buffer) {
       v8.enableVertexAttribArray(v776);
      }
      v778 = v768 || 1;
      if (v777.type !== v771 || v777.size !== v778 || v777.buffer !== v764 || v777.normalized !== v766 || v777.offset !== v767 || v777.stride !== v770) {
       v8.bindBuffer(34962, v764.buffer);
       v8.vertexAttribPointer(v776, v778, v771, v766, v770, v767);
       v777.type = v771;
       v777.size = v778;
       v777.buffer = v764;
       v777.normalized = v766;
       v777.offset = v767;
       v777.stride = v770;
      }
      if (v777.divisor !== v765) {
       v611.vertexAttribDivisorANGLE(v776, v765);
       v777.divisor = v765;
      }
     }
     else {
      if (v777.buffer) {
       v8.disableVertexAttribArray(v776);
       v777.buffer = null;
      }
      if (v777.x !== v773 || v777.y !== v774 || v777.z !== v775 || v777.w !== v772) {
       v8.vertexAttrib4f(v776, v773, v774, v775, v772);
       v777.x = v773;
       v777.y = v774;
       v777.z = v775;
       v777.w = v772;
      }
     }
     v779 = v2['pixelRatio'];
     if (!v612 || v780 !== v779) {
      v780 = v779;
      v8.uniform1f(pixelRatio.location, v779);
     }
     v781 = v613['scale'];
     v782 = v781[0];
     v784 = v781[1];
     if (!v612 || v783 !== v782 || v785 !== v784) {
      v783 = v782;
      v785 = v784;
      v8.uniform2f(scale.location, v782, v784);
     }
     v786 = v613['scaleFract'];
     v787 = v786[0];
     v789 = v786[1];
     if (!v612 || v788 !== v787 || v790 !== v789) {
      v788 = v787;
      v790 = v789;
      v8.uniform2f(scaleFract.location, v787, v789);
     }
     v791 = v613['translate'];
     v792 = v791[0];
     v794 = v791[1];
     if (!v612 || v793 !== v792 || v795 !== v794) {
      v793 = v792;
      v795 = v794;
      v8.uniform2f(translate.location, v792, v794);
     }
     v796 = v613['translateFract'];
     v797 = v796[0];
     v799 = v796[1];
     if (!v612 || v798 !== v797 || v800 !== v799) {
      v798 = v797;
      v800 = v799;
      v8.uniform2f(translateFract.location, v797, v799);
     }
     v801 = $45.call(this, v2, v613, v612);
     v802 = v801[0];
     v804 = v801[1];
     if (!v612 || v803 !== v802 || v805 !== v804) {
      v803 = v802;
      v805 = v804;
      v8.uniform2f(paletteSize.location, v802, v804);
     }
     v806 = v613['opacity'];
     if (!v612 || v807 !== v806) {
      v807 = v806;
      v8.uniform1f(opacity.location, v806);
     }
     v808 = v613['markerTexture'];
     if (v808 && v808._reglType === 'framebuffer') {
      v808 = v808.color[0];
     }
     v809 = v808._texture;
     v8.uniform1i(markerTexture.location, v809.bind());
     v810 = v613['elements'];
     v811 = null;
     v812 = v9(v810);
     if (v812) {
      v811 = v5.createStream(v810);
     }
     else {
      v811 = v5.getElements(v810);
     }
     if (v811) v8.bindBuffer(34963, v811.buffer.buffer);
     v813 = v613['offset'];
     v814 = v613['count'];
     if (v814) {
      if (v815 > 0) {
       if (v811) {
        v611.drawElementsInstancedANGLE(0, v814, v811.type, v813 << ((v811.type - 5121) >> 1), v815);
       }
       else {
        v611.drawArraysInstancedANGLE(0, v813, v814, v815);
       }
      }
      else if (v815 < 0) {
       if (v811) {
        v8.drawElements(0, v814, v811.type, v813 << ((v811.type - 5121) >> 1));
       }
       else {
        v8.drawArrays(0, v813, v814);
       }
      }
      v2.viewportWidth = v619;
      v2.viewportHeight = v620;
      if (v627) {
       v1.destroyStream(v628);
      }
      if (v644) {
       v1.destroyStream(v645);
      }
      if (v661) {
       v1.destroyStream(v662);
      }
      if (v678) {
       v1.destroyStream(v679);
      }
      if (v695) {
       v1.destroyStream(v696);
      }
      if (v712) {
       v1.destroyStream(v713);
      }
      if (v729) {
       v1.destroyStream(v730);
      }
      if (v746) {
       v1.destroyStream(v747);
      }
      if (v763) {
       v1.destroyStream(v764);
      }
      v809.unbind();
      if (v812) {
       v5.destroyStream(v811);
      }
     }
    }
    $44.unbind();
    v3.dirty = true;
    v15.setVAO(null);
    if (v609) {
     $1.cpuTime += performance.now() - v610;
    }
   }
   , 'draw': function (a0) {
    var v47, v48, v83, v84, v85, v86, v87, v88, v89, v90, v91, v92, v93, v94, v95, v96, v97, v98, v99, v100, v101, v102, v103, v104, v105, v106, v107, v108, v109, v110, v111, v112, v113, v114, v115, v116, v117, v118, v119, v120, v121, v122, v123, v124, v125, v126, v127, v128, v129, v130, v131, v132, v133, v134, v135, v136, v137, v138, v139, v140, v141, v142, v143, v144, v145, v146, v147, v148, v149, v150, v151, v152, v153, v154, v155, v156, v157, v158, v159, v160, v161, v162, v163, v164, v165, v166, v167, v168, v169, v170, v171, v172, v173, v174, v175, v176, v177, v178, v179, v180, v181, v182, v183, v184, v185, v186, v187, v188, v189, v190, v191, v192, v193, v194, v195, v196, v197, v198, v199, v200, v201, v202, v203, v204, v205, v206, v207, v208, v209, v210, v211, v212, v213, v214, v215, v216, v217, v218, v219, v220, v221, v222, v223, v224, v225, v226, v227, v228, v229, v230, v231, v232, v233, v234, v235, v236, v237, v238, v239, v240, v241, v242, v243, v244, v245, v246, v247, v248, v249, v250, v251, v252, v253, v254, v255, v256, v257, v258, v259, v260, v261, v262, v263, v264, v265, v266, v267, v268, v269, v270, v271, v272, v273, v274, v275;
    v47 = v6.angle_instanced_arrays;
    v48 = v7.next;
    if (v48 !== v7.cur) {
     if (v48) {
      v8.bindFramebuffer(36160, v48.framebuffer);
     }
     else {
      v8.bindFramebuffer(36160, null);
     }
     v7.cur = v48;
    }
    if (v3.dirty) {
     var v49, v50, v51, v52, v53, v54, v55, v56, v57, v58, v59, v60, v61, v62, v63, v64, v65, v66, v67, v68, v69, v70, v71, v72, v73, v74, v75, v76, v77, v78, v79, v80, v81, v82;
     v49 = v10.dither;
     if (v49 !== v3.dither) {
      if (v49) {
       v8.enable(3024);
      }
      else {
       v8.disable(3024);
      }
      v3.dither = v49;
     }
     v50 = v18[0];
     v51 = v18[1];
     if (v50 !== v19[0] || v51 !== v19[1]) {
      v8.blendEquationSeparate(v50, v51);
      v19[0] = v50;
      v19[1] = v51;
     }
     v52 = v10.depth_func;
     if (v52 !== v3.depth_func) {
      v8.depthFunc(v52);
      v3.depth_func = v52;
     }
     v53 = v24[0];
     v54 = v24[1];
     if (v53 !== v25[0] || v54 !== v25[1]) {
      v8.depthRange(v53, v54);
      v25[0] = v53;
      v25[1] = v54;
     }
     v55 = v10.depth_mask;
     if (v55 !== v3.depth_mask) {
      v8.depthMask(v55);
      v3.depth_mask = v55;
     }
     v56 = v22[0];
     v57 = v22[1];
     v58 = v22[2];
     v59 = v22[3];
     if (v56 !== v23[0] || v57 !== v23[1] || v58 !== v23[2] || v59 !== v23[3]) {
      v8.colorMask(v56, v57, v58, v59);
      v23[0] = v56;
      v23[1] = v57;
      v23[2] = v58;
      v23[3] = v59;
     }
     v60 = v10.cull_enable;
     if (v60 !== v3.cull_enable) {
      if (v60) {
       v8.enable(2884);
      }
      else {
       v8.disable(2884);
      }
      v3.cull_enable = v60;
     }
     v61 = v10.cull_face;
     if (v61 !== v3.cull_face) {
      v8.cullFace(v61);
      v3.cull_face = v61;
     }
     v62 = v10.frontFace;
     if (v62 !== v3.frontFace) {
      v8.frontFace(v62);
      v3.frontFace = v62;
     }
     v63 = v10.lineWidth;
     if (v63 !== v3.lineWidth) {
      v8.lineWidth(v63);
      v3.lineWidth = v63;
     }
     v64 = v10.polygonOffset_enable;
     if (v64 !== v3.polygonOffset_enable) {
      if (v64) {
       v8.enable(32823);
      }
      else {
       v8.disable(32823);
      }
      v3.polygonOffset_enable = v64;
     }
     v65 = v26[0];
     v66 = v26[1];
     if (v65 !== v27[0] || v66 !== v27[1]) {
      v8.polygonOffset(v65, v66);
      v27[0] = v65;
      v27[1] = v66;
     }
     v67 = v10.sample_alpha;
     if (v67 !== v3.sample_alpha) {
      if (v67) {
       v8.enable(32926);
      }
      else {
       v8.disable(32926);
      }
      v3.sample_alpha = v67;
     }
     v68 = v10.sample_enable;
     if (v68 !== v3.sample_enable) {
      if (v68) {
       v8.enable(32928);
      }
      else {
       v8.disable(32928);
      }
      v3.sample_enable = v68;
     }
     v69 = v28[0];
     v70 = v28[1];
     if (v69 !== v29[0] || v70 !== v29[1]) {
      v8.sampleCoverage(v69, v70);
      v29[0] = v69;
      v29[1] = v70;
     }
     v71 = v10.stencil_mask;
     if (v71 !== v3.stencil_mask) {
      v8.stencilMask(v71);
      v3.stencil_mask = v71;
     }
     v72 = v32[0];
     v73 = v32[1];
     v74 = v32[2];
     if (v72 !== v33[0] || v73 !== v33[1] || v74 !== v33[2]) {
      v8.stencilFunc(v72, v73, v74);
      v33[0] = v72;
      v33[1] = v73;
      v33[2] = v74;
     }
     v75 = v36[0];
     v76 = v36[1];
     v77 = v36[2];
     v78 = v36[3];
     if (v75 !== v37[0] || v76 !== v37[1] || v77 !== v37[2] || v78 !== v37[3]) {
      v8.stencilOpSeparate(v75, v76, v77, v78);
      v37[0] = v75;
      v37[1] = v76;
      v37[2] = v77;
      v37[3] = v78;
     }
     v79 = v34[0];
     v80 = v34[1];
     v81 = v34[2];
     v82 = v34[3];
     if (v79 !== v35[0] || v80 !== v35[1] || v81 !== v35[2] || v82 !== v35[3]) {
      v8.stencilOpSeparate(v79, v80, v81, v82);
      v35[0] = v79;
      v35[1] = v80;
      v35[2] = v81;
      v35[3] = v82;
     }
    }
    v83 = a0['viewport'];
    v84 = v83.x | 0;
    v85 = v83.y | 0;
    v86 = 'width' in v83 ? v83.width | 0 : (v2.framebufferWidth - v84);
    v87 = 'height' in v83 ? v83.height | 0 : (v2.framebufferHeight - v85);
    v88 = v2.viewportWidth;
    v2.viewportWidth = v86;
    v89 = v2.viewportHeight;
    v2.viewportHeight = v87;
    v8.viewport(v84, v85, v86, v87);
    v39[0] = v84;
    v39[1] = v85;
    v39[2] = v86;
    v39[3] = v87;
    v8.blendColor(0, 0, 0, 1);
    v17[0] = 0;
    v17[1] = 0;
    v17[2] = 0;
    v17[3] = 1;
    v8.enable(3042);
    v3.blend_enable = true;
    v8.blendFuncSeparate(770, 771, 773, 1);
    v21[0] = 770;
    v21[1] = 771;
    v21[2] = 773;
    v21[3] = 1;
    v8.disable(2929);
    v3.depth_enable = false;
    v90 = a0['viewport'];
    v91 = v90.x | 0;
    v92 = v90.y | 0;
    v93 = 'width' in v90 ? v90.width | 0 : (v2.framebufferWidth - v91);
    v94 = 'height' in v90 ? v90.height | 0 : (v2.framebufferHeight - v92);
    v8.scissor(v91, v92, v93, v94);
    v31[0] = v91;
    v31[1] = v92;
    v31[2] = v93;
    v31[3] = v94;
    v8.enable(3089);
    v3.scissor_enable = true;
    v8.disable(2960);
    v3.stencil_enable = false;
    v95 = v3.profile;
    if (v95) {
     v96 = performance.now();
     $1.count++;
    }
    v8.useProgram($2.program);
    v97 = v6.angle_instanced_arrays;
    v15.setVAO(null);
    v98 = $3.call(this, v2, a0, 0);
    v99 = false;
    v100 = null;
    v101 = 0;
    v102 = false;
    v103 = 0;
    v104 = 0;
    v105 = 1;
    v106 = 0;
    v107 = 5126;
    v108 = 0;
    v109 = 0;
    v110 = 0;
    v111 = 0;
    if (v9(v98)) {
     v99 = true;
     v100 = v1.createStream(34962, v98);
     v107 = v100.dtype;
    }
    else {
     v100 = v1.getBuffer(v98);
     if (v100) {
      v107 = v100.dtype;
     }
     else if ('constant' in v98) {
      v105 = 2;
      if (typeof v98.constant === 'number') {
       v109 = v98.constant;
       v110 = v111 = v108 = 0;
      }
      else {
       v109 = v98.constant.length > 0 ? v98.constant[0] : 0;
       v110 = v98.constant.length > 1 ? v98.constant[1] : 0;
       v111 = v98.constant.length > 2 ? v98.constant[2] : 0;
       v108 = v98.constant.length > 3 ? v98.constant[3] : 0;
      }
     }
     else {
      if (v9(v98.buffer)) {
       v100 = v1.createStream(34962, v98.buffer);
      }
      else {
       v100 = v1.getBuffer(v98.buffer);
      }
      v107 = 'type' in v98 ? v43[v98.type] : v100.dtype;
      v102 = !!v98.normalized;
      v104 = v98.size | 0;
      v103 = v98.offset | 0;
      v106 = v98.stride | 0;
      v101 = v98.divisor | 0;
     }
    }
    v112 = x.location;
    v113 = v0[v112];
    if (v105 === 1) {
     if (!v113.buffer) {
      v8.enableVertexAttribArray(v112);
     }
     v114 = v104 || 1;
     if (v113.type !== v107 || v113.size !== v114 || v113.buffer !== v100 || v113.normalized !== v102 || v113.offset !== v103 || v113.stride !== v106) {
      v8.bindBuffer(34962, v100.buffer);
      v8.vertexAttribPointer(v112, v114, v107, v102, v106, v103);
      v113.type = v107;
      v113.size = v114;
      v113.buffer = v100;
      v113.normalized = v102;
      v113.offset = v103;
      v113.stride = v106;
     }
     if (v113.divisor !== v101) {
      v97.vertexAttribDivisorANGLE(v112, v101);
      v113.divisor = v101;
     }
    }
    else {
     if (v113.buffer) {
      v8.disableVertexAttribArray(v112);
      v113.buffer = null;
     }
     if (v113.x !== v109 || v113.y !== v110 || v113.z !== v111 || v113.w !== v108) {
      v8.vertexAttrib4f(v112, v109, v110, v111, v108);
      v113.x = v109;
      v113.y = v110;
      v113.z = v111;
      v113.w = v108;
     }
    }
    v115 = $4.call(this, v2, a0, 0);
    v116 = false;
    v117 = null;
    v118 = 0;
    v119 = false;
    v120 = 0;
    v121 = 0;
    v122 = 1;
    v123 = 0;
    v124 = 5126;
    v125 = 0;
    v126 = 0;
    v127 = 0;
    v128 = 0;
    if (v9(v115)) {
     v116 = true;
     v117 = v1.createStream(34962, v115);
     v124 = v117.dtype;
    }
    else {
     v117 = v1.getBuffer(v115);
     if (v117) {
      v124 = v117.dtype;
     }
     else if ('constant' in v115) {
      v122 = 2;
      if (typeof v115.constant === 'number') {
       v126 = v115.constant;
       v127 = v128 = v125 = 0;
      }
      else {
       v126 = v115.constant.length > 0 ? v115.constant[0] : 0;
       v127 = v115.constant.length > 1 ? v115.constant[1] : 0;
       v128 = v115.constant.length > 2 ? v115.constant[2] : 0;
       v125 = v115.constant.length > 3 ? v115.constant[3] : 0;
      }
     }
     else {
      if (v9(v115.buffer)) {
       v117 = v1.createStream(34962, v115.buffer);
      }
      else {
       v117 = v1.getBuffer(v115.buffer);
      }
      v124 = 'type' in v115 ? v43[v115.type] : v117.dtype;
      v119 = !!v115.normalized;
      v121 = v115.size | 0;
      v120 = v115.offset | 0;
      v123 = v115.stride | 0;
      v118 = v115.divisor | 0;
     }
    }
    v129 = y.location;
    v130 = v0[v129];
    if (v122 === 1) {
     if (!v130.buffer) {
      v8.enableVertexAttribArray(v129);
     }
     v131 = v121 || 1;
     if (v130.type !== v124 || v130.size !== v131 || v130.buffer !== v117 || v130.normalized !== v119 || v130.offset !== v120 || v130.stride !== v123) {
      v8.bindBuffer(34962, v117.buffer);
      v8.vertexAttribPointer(v129, v131, v124, v119, v123, v120);
      v130.type = v124;
      v130.size = v131;
      v130.buffer = v117;
      v130.normalized = v119;
      v130.offset = v120;
      v130.stride = v123;
     }
     if (v130.divisor !== v118) {
      v97.vertexAttribDivisorANGLE(v129, v118);
      v130.divisor = v118;
     }
    }
    else {
     if (v130.buffer) {
      v8.disableVertexAttribArray(v129);
      v130.buffer = null;
     }
     if (v130.x !== v126 || v130.y !== v127 || v130.z !== v128 || v130.w !== v125) {
      v8.vertexAttrib4f(v129, v126, v127, v128, v125);
      v130.x = v126;
      v130.y = v127;
      v130.z = v128;
      v130.w = v125;
     }
    }
    v132 = $5.call(this, v2, a0, 0);
    v133 = false;
    v134 = null;
    v135 = 0;
    v136 = false;
    v137 = 0;
    v138 = 0;
    v139 = 1;
    v140 = 0;
    v141 = 5126;
    v142 = 0;
    v143 = 0;
    v144 = 0;
    v145 = 0;
    if (v9(v132)) {
     v133 = true;
     v134 = v1.createStream(34962, v132);
     v141 = v134.dtype;
    }
    else {
     v134 = v1.getBuffer(v132);
     if (v134) {
      v141 = v134.dtype;
     }
     else if ('constant' in v132) {
      v139 = 2;
      if (typeof v132.constant === 'number') {
       v143 = v132.constant;
       v144 = v145 = v142 = 0;
      }
      else {
       v143 = v132.constant.length > 0 ? v132.constant[0] : 0;
       v144 = v132.constant.length > 1 ? v132.constant[1] : 0;
       v145 = v132.constant.length > 2 ? v132.constant[2] : 0;
       v142 = v132.constant.length > 3 ? v132.constant[3] : 0;
      }
     }
     else {
      if (v9(v132.buffer)) {
       v134 = v1.createStream(34962, v132.buffer);
      }
      else {
       v134 = v1.getBuffer(v132.buffer);
      }
      v141 = 'type' in v132 ? v43[v132.type] : v134.dtype;
      v136 = !!v132.normalized;
      v138 = v132.size | 0;
      v137 = v132.offset | 0;
      v140 = v132.stride | 0;
      v135 = v132.divisor | 0;
     }
    }
    v146 = xFract.location;
    v147 = v0[v146];
    if (v139 === 1) {
     if (!v147.buffer) {
      v8.enableVertexAttribArray(v146);
     }
     v148 = v138 || 1;
     if (v147.type !== v141 || v147.size !== v148 || v147.buffer !== v134 || v147.normalized !== v136 || v147.offset !== v137 || v147.stride !== v140) {
      v8.bindBuffer(34962, v134.buffer);
      v8.vertexAttribPointer(v146, v148, v141, v136, v140, v137);
      v147.type = v141;
      v147.size = v148;
      v147.buffer = v134;
      v147.normalized = v136;
      v147.offset = v137;
      v147.stride = v140;
     }
     if (v147.divisor !== v135) {
      v97.vertexAttribDivisorANGLE(v146, v135);
      v147.divisor = v135;
     }
    }
    else {
     if (v147.buffer) {
      v8.disableVertexAttribArray(v146);
      v147.buffer = null;
     }
     if (v147.x !== v143 || v147.y !== v144 || v147.z !== v145 || v147.w !== v142) {
      v8.vertexAttrib4f(v146, v143, v144, v145, v142);
      v147.x = v143;
      v147.y = v144;
      v147.z = v145;
      v147.w = v142;
     }
    }
    v149 = $6.call(this, v2, a0, 0);
    v150 = false;
    v151 = null;
    v152 = 0;
    v153 = false;
    v154 = 0;
    v155 = 0;
    v156 = 1;
    v157 = 0;
    v158 = 5126;
    v159 = 0;
    v160 = 0;
    v161 = 0;
    v162 = 0;
    if (v9(v149)) {
     v150 = true;
     v151 = v1.createStream(34962, v149);
     v158 = v151.dtype;
    }
    else {
     v151 = v1.getBuffer(v149);
     if (v151) {
      v158 = v151.dtype;
     }
     else if ('constant' in v149) {
      v156 = 2;
      if (typeof v149.constant === 'number') {
       v160 = v149.constant;
       v161 = v162 = v159 = 0;
      }
      else {
       v160 = v149.constant.length > 0 ? v149.constant[0] : 0;
       v161 = v149.constant.length > 1 ? v149.constant[1] : 0;
       v162 = v149.constant.length > 2 ? v149.constant[2] : 0;
       v159 = v149.constant.length > 3 ? v149.constant[3] : 0;
      }
     }
     else {
      if (v9(v149.buffer)) {
       v151 = v1.createStream(34962, v149.buffer);
      }
      else {
       v151 = v1.getBuffer(v149.buffer);
      }
      v158 = 'type' in v149 ? v43[v149.type] : v151.dtype;
      v153 = !!v149.normalized;
      v155 = v149.size | 0;
      v154 = v149.offset | 0;
      v157 = v149.stride | 0;
      v152 = v149.divisor | 0;
     }
    }
    v163 = yFract.location;
    v164 = v0[v163];
    if (v156 === 1) {
     if (!v164.buffer) {
      v8.enableVertexAttribArray(v163);
     }
     v165 = v155 || 1;
     if (v164.type !== v158 || v164.size !== v165 || v164.buffer !== v151 || v164.normalized !== v153 || v164.offset !== v154 || v164.stride !== v157) {
      v8.bindBuffer(34962, v151.buffer);
      v8.vertexAttribPointer(v163, v165, v158, v153, v157, v154);
      v164.type = v158;
      v164.size = v165;
      v164.buffer = v151;
      v164.normalized = v153;
      v164.offset = v154;
      v164.stride = v157;
     }
     if (v164.divisor !== v152) {
      v97.vertexAttribDivisorANGLE(v163, v152);
      v164.divisor = v152;
     }
    }
    else {
     if (v164.buffer) {
      v8.disableVertexAttribArray(v163);
      v164.buffer = null;
     }
     if (v164.x !== v160 || v164.y !== v161 || v164.z !== v162 || v164.w !== v159) {
      v8.vertexAttrib4f(v163, v160, v161, v162, v159);
      v164.x = v160;
      v164.y = v161;
      v164.z = v162;
      v164.w = v159;
     }
    }
    v166 = $7.call(this, v2, a0, 0);
    v167 = false;
    v168 = null;
    v169 = 0;
    v170 = false;
    v171 = 0;
    v172 = 0;
    v173 = 1;
    v174 = 0;
    v175 = 5126;
    v176 = 0;
    v177 = 0;
    v178 = 0;
    v179 = 0;
    if (v9(v166)) {
     v167 = true;
     v168 = v1.createStream(34962, v166);
     v175 = v168.dtype;
    }
    else {
     v168 = v1.getBuffer(v166);
     if (v168) {
      v175 = v168.dtype;
     }
     else if ('constant' in v166) {
      v173 = 2;
      if (typeof v166.constant === 'number') {
       v177 = v166.constant;
       v178 = v179 = v176 = 0;
      }
      else {
       v177 = v166.constant.length > 0 ? v166.constant[0] : 0;
       v178 = v166.constant.length > 1 ? v166.constant[1] : 0;
       v179 = v166.constant.length > 2 ? v166.constant[2] : 0;
       v176 = v166.constant.length > 3 ? v166.constant[3] : 0;
      }
     }
     else {
      if (v9(v166.buffer)) {
       v168 = v1.createStream(34962, v166.buffer);
      }
      else {
       v168 = v1.getBuffer(v166.buffer);
      }
      v175 = 'type' in v166 ? v43[v166.type] : v168.dtype;
      v170 = !!v166.normalized;
      v172 = v166.size | 0;
      v171 = v166.offset | 0;
      v174 = v166.stride | 0;
      v169 = v166.divisor | 0;
     }
    }
    v180 = size.location;
    v181 = v0[v180];
    if (v173 === 1) {
     if (!v181.buffer) {
      v8.enableVertexAttribArray(v180);
     }
     v182 = v172 || 1;
     if (v181.type !== v175 || v181.size !== v182 || v181.buffer !== v168 || v181.normalized !== v170 || v181.offset !== v171 || v181.stride !== v174) {
      v8.bindBuffer(34962, v168.buffer);
      v8.vertexAttribPointer(v180, v182, v175, v170, v174, v171);
      v181.type = v175;
      v181.size = v182;
      v181.buffer = v168;
      v181.normalized = v170;
      v181.offset = v171;
      v181.stride = v174;
     }
     if (v181.divisor !== v169) {
      v97.vertexAttribDivisorANGLE(v180, v169);
      v181.divisor = v169;
     }
    }
    else {
     if (v181.buffer) {
      v8.disableVertexAttribArray(v180);
      v181.buffer = null;
     }
     if (v181.x !== v177 || v181.y !== v178 || v181.z !== v179 || v181.w !== v176) {
      v8.vertexAttrib4f(v180, v177, v178, v179, v176);
      v181.x = v177;
      v181.y = v178;
      v181.z = v179;
      v181.w = v176;
     }
    }
    v183 = $8.call(this, v2, a0, 0);
    v184 = false;
    v185 = null;
    v186 = 0;
    v187 = false;
    v188 = 0;
    v189 = 0;
    v190 = 1;
    v191 = 0;
    v192 = 5126;
    v193 = 0;
    v194 = 0;
    v195 = 0;
    v196 = 0;
    if (v9(v183)) {
     v184 = true;
     v185 = v1.createStream(34962, v183);
     v192 = v185.dtype;
    }
    else {
     v185 = v1.getBuffer(v183);
     if (v185) {
      v192 = v185.dtype;
     }
     else if ('constant' in v183) {
      v190 = 2;
      if (typeof v183.constant === 'number') {
       v194 = v183.constant;
       v195 = v196 = v193 = 0;
      }
      else {
       v194 = v183.constant.length > 0 ? v183.constant[0] : 0;
       v195 = v183.constant.length > 1 ? v183.constant[1] : 0;
       v196 = v183.constant.length > 2 ? v183.constant[2] : 0;
       v193 = v183.constant.length > 3 ? v183.constant[3] : 0;
      }
     }
     else {
      if (v9(v183.buffer)) {
       v185 = v1.createStream(34962, v183.buffer);
      }
      else {
       v185 = v1.getBuffer(v183.buffer);
      }
      v192 = 'type' in v183 ? v43[v183.type] : v185.dtype;
      v187 = !!v183.normalized;
      v189 = v183.size | 0;
      v188 = v183.offset | 0;
      v191 = v183.stride | 0;
      v186 = v183.divisor | 0;
     }
    }
    v197 = borderSize.location;
    v198 = v0[v197];
    if (v190 === 1) {
     if (!v198.buffer) {
      v8.enableVertexAttribArray(v197);
     }
     v199 = v189 || 1;
     if (v198.type !== v192 || v198.size !== v199 || v198.buffer !== v185 || v198.normalized !== v187 || v198.offset !== v188 || v198.stride !== v191) {
      v8.bindBuffer(34962, v185.buffer);
      v8.vertexAttribPointer(v197, v199, v192, v187, v191, v188);
      v198.type = v192;
      v198.size = v199;
      v198.buffer = v185;
      v198.normalized = v187;
      v198.offset = v188;
      v198.stride = v191;
     }
     if (v198.divisor !== v186) {
      v97.vertexAttribDivisorANGLE(v197, v186);
      v198.divisor = v186;
     }
    }
    else {
     if (v198.buffer) {
      v8.disableVertexAttribArray(v197);
      v198.buffer = null;
     }
     if (v198.x !== v194 || v198.y !== v195 || v198.z !== v196 || v198.w !== v193) {
      v8.vertexAttrib4f(v197, v194, v195, v196, v193);
      v198.x = v194;
      v198.y = v195;
      v198.z = v196;
      v198.w = v193;
     }
    }
    v200 = $9.call(this, v2, a0, 0);
    v201 = false;
    v202 = null;
    v203 = 0;
    v204 = false;
    v205 = 0;
    v206 = 0;
    v207 = 1;
    v208 = 0;
    v209 = 5126;
    v210 = 0;
    v211 = 0;
    v212 = 0;
    v213 = 0;
    if (v9(v200)) {
     v201 = true;
     v202 = v1.createStream(34962, v200);
     v209 = v202.dtype;
    }
    else {
     v202 = v1.getBuffer(v200);
     if (v202) {
      v209 = v202.dtype;
     }
     else if ('constant' in v200) {
      v207 = 2;
      if (typeof v200.constant === 'number') {
       v211 = v200.constant;
       v212 = v213 = v210 = 0;
      }
      else {
       v211 = v200.constant.length > 0 ? v200.constant[0] : 0;
       v212 = v200.constant.length > 1 ? v200.constant[1] : 0;
       v213 = v200.constant.length > 2 ? v200.constant[2] : 0;
       v210 = v200.constant.length > 3 ? v200.constant[3] : 0;
      }
     }
     else {
      if (v9(v200.buffer)) {
       v202 = v1.createStream(34962, v200.buffer);
      }
      else {
       v202 = v1.getBuffer(v200.buffer);
      }
      v209 = 'type' in v200 ? v43[v200.type] : v202.dtype;
      v204 = !!v200.normalized;
      v206 = v200.size | 0;
      v205 = v200.offset | 0;
      v208 = v200.stride | 0;
      v203 = v200.divisor | 0;
     }
    }
    v214 = colorId.location;
    v215 = v0[v214];
    if (v207 === 1) {
     if (!v215.buffer) {
      v8.enableVertexAttribArray(v214);
     }
     v216 = v206 || 4;
     if (v215.type !== v209 || v215.size !== v216 || v215.buffer !== v202 || v215.normalized !== v204 || v215.offset !== v205 || v215.stride !== v208) {
      v8.bindBuffer(34962, v202.buffer);
      v8.vertexAttribPointer(v214, v216, v209, v204, v208, v205);
      v215.type = v209;
      v215.size = v216;
      v215.buffer = v202;
      v215.normalized = v204;
      v215.offset = v205;
      v215.stride = v208;
     }
     if (v215.divisor !== v203) {
      v97.vertexAttribDivisorANGLE(v214, v203);
      v215.divisor = v203;
     }
    }
    else {
     if (v215.buffer) {
      v8.disableVertexAttribArray(v214);
      v215.buffer = null;
     }
     if (v215.x !== v211 || v215.y !== v212 || v215.z !== v213 || v215.w !== v210) {
      v8.vertexAttrib4f(v214, v211, v212, v213, v210);
      v215.x = v211;
      v215.y = v212;
      v215.z = v213;
      v215.w = v210;
     }
    }
    v217 = $10.call(this, v2, a0, 0);
    v218 = false;
    v219 = null;
    v220 = 0;
    v221 = false;
    v222 = 0;
    v223 = 0;
    v224 = 1;
    v225 = 0;
    v226 = 5126;
    v227 = 0;
    v228 = 0;
    v229 = 0;
    v230 = 0;
    if (v9(v217)) {
     v218 = true;
     v219 = v1.createStream(34962, v217);
     v226 = v219.dtype;
    }
    else {
     v219 = v1.getBuffer(v217);
     if (v219) {
      v226 = v219.dtype;
     }
     else if ('constant' in v217) {
      v224 = 2;
      if (typeof v217.constant === 'number') {
       v228 = v217.constant;
       v229 = v230 = v227 = 0;
      }
      else {
       v228 = v217.constant.length > 0 ? v217.constant[0] : 0;
       v229 = v217.constant.length > 1 ? v217.constant[1] : 0;
       v230 = v217.constant.length > 2 ? v217.constant[2] : 0;
       v227 = v217.constant.length > 3 ? v217.constant[3] : 0;
      }
     }
     else {
      if (v9(v217.buffer)) {
       v219 = v1.createStream(34962, v217.buffer);
      }
      else {
       v219 = v1.getBuffer(v217.buffer);
      }
      v226 = 'type' in v217 ? v43[v217.type] : v219.dtype;
      v221 = !!v217.normalized;
      v223 = v217.size | 0;
      v222 = v217.offset | 0;
      v225 = v217.stride | 0;
      v220 = v217.divisor | 0;
     }
    }
    v231 = borderColorId.location;
    v232 = v0[v231];
    if (v224 === 1) {
     if (!v232.buffer) {
      v8.enableVertexAttribArray(v231);
     }
     v233 = v223 || 4;
     if (v232.type !== v226 || v232.size !== v233 || v232.buffer !== v219 || v232.normalized !== v221 || v232.offset !== v222 || v232.stride !== v225) {
      v8.bindBuffer(34962, v219.buffer);
      v8.vertexAttribPointer(v231, v233, v226, v221, v225, v222);
      v232.type = v226;
      v232.size = v233;
      v232.buffer = v219;
      v232.normalized = v221;
      v232.offset = v222;
      v232.stride = v225;
     }
     if (v232.divisor !== v220) {
      v97.vertexAttribDivisorANGLE(v231, v220);
      v232.divisor = v220;
     }
    }
    else {
     if (v232.buffer) {
      v8.disableVertexAttribArray(v231);
      v232.buffer = null;
     }
     if (v232.x !== v228 || v232.y !== v229 || v232.z !== v230 || v232.w !== v227) {
      v8.vertexAttrib4f(v231, v228, v229, v230, v227);
      v232.x = v228;
      v232.y = v229;
      v232.z = v230;
      v232.w = v227;
     }
    }
    v234 = $11.call(this, v2, a0, 0);
    v235 = false;
    v236 = null;
    v237 = 0;
    v238 = false;
    v239 = 0;
    v240 = 0;
    v241 = 1;
    v242 = 0;
    v243 = 5126;
    v244 = 0;
    v245 = 0;
    v246 = 0;
    v247 = 0;
    if (v9(v234)) {
     v235 = true;
     v236 = v1.createStream(34962, v234);
     v243 = v236.dtype;
    }
    else {
     v236 = v1.getBuffer(v234);
     if (v236) {
      v243 = v236.dtype;
     }
     else if ('constant' in v234) {
      v241 = 2;
      if (typeof v234.constant === 'number') {
       v245 = v234.constant;
       v246 = v247 = v244 = 0;
      }
      else {
       v245 = v234.constant.length > 0 ? v234.constant[0] : 0;
       v246 = v234.constant.length > 1 ? v234.constant[1] : 0;
       v247 = v234.constant.length > 2 ? v234.constant[2] : 0;
       v244 = v234.constant.length > 3 ? v234.constant[3] : 0;
      }
     }
     else {
      if (v9(v234.buffer)) {
       v236 = v1.createStream(34962, v234.buffer);
      }
      else {
       v236 = v1.getBuffer(v234.buffer);
      }
      v243 = 'type' in v234 ? v43[v234.type] : v236.dtype;
      v238 = !!v234.normalized;
      v240 = v234.size | 0;
      v239 = v234.offset | 0;
      v242 = v234.stride | 0;
      v237 = v234.divisor | 0;
     }
    }
    v248 = isActive.location;
    v249 = v0[v248];
    if (v241 === 1) {
     if (!v249.buffer) {
      v8.enableVertexAttribArray(v248);
     }
     v250 = v240 || 1;
     if (v249.type !== v243 || v249.size !== v250 || v249.buffer !== v236 || v249.normalized !== v238 || v249.offset !== v239 || v249.stride !== v242) {
      v8.bindBuffer(34962, v236.buffer);
      v8.vertexAttribPointer(v248, v250, v243, v238, v242, v239);
      v249.type = v243;
      v249.size = v250;
      v249.buffer = v236;
      v249.normalized = v238;
      v249.offset = v239;
      v249.stride = v242;
     }
     if (v249.divisor !== v237) {
      v97.vertexAttribDivisorANGLE(v248, v237);
      v249.divisor = v237;
     }
    }
    else {
     if (v249.buffer) {
      v8.disableVertexAttribArray(v248);
      v249.buffer = null;
     }
     if (v249.x !== v245 || v249.y !== v246 || v249.z !== v247 || v249.w !== v244) {
      v8.vertexAttrib4f(v248, v245, v246, v247, v244);
      v249.x = v245;
      v249.y = v246;
      v249.z = v247;
      v249.w = v244;
     }
    }
    v8.uniform1i(constPointSize.location, false);
    v251 = v2['pixelRatio'];
    v8.uniform1f(pixelRatio.location, v251);
    v252 = a0['scale'];
    v253 = v252[0];
    v254 = v252[1];
    v8.uniform2f(scale.location, v253, v254);
    v255 = a0['scaleFract'];
    v256 = v255[0];
    v257 = v255[1];
    v8.uniform2f(scaleFract.location, v256, v257);
    v258 = a0['translate'];
    v259 = v258[0];
    v260 = v258[1];
    v8.uniform2f(translate.location, v259, v260);
    v261 = a0['translateFract'];
    v262 = v261[0];
    v263 = v261[1];
    v8.uniform2f(translateFract.location, v262, v263);
    v264 = $12.call(this, v2, a0, 0);
    v265 = v264[0];
    v266 = v264[1];
    v8.uniform2f(paletteSize.location, v265, v266);
    v267 = a0['opacity'];
    v8.uniform1f(opacity.location, v267);
    v8.uniform1i(paletteTexture.location, $13.bind());
    v268 = a0['markerTexture'];
    if (v268 && v268._reglType === 'framebuffer') {
     v268 = v268.color[0];
    }
    v269 = v268._texture;
    v8.uniform1i(markerTexture.location, v269.bind());
    v270 = a0['elements'];
    v271 = null;
    v272 = v9(v270);
    if (v272) {
     v271 = v5.createStream(v270);
    }
    else {
     v271 = v5.getElements(v270);
    }
    if (v271) v8.bindBuffer(34963, v271.buffer.buffer);
    v273 = a0['offset'];
    v274 = a0['count'];
    if (v274) {
     v275 = v4.instances;
     if (v275 > 0) {
      if (v271) {
       v97.drawElementsInstancedANGLE(0, v274, v271.type, v273 << ((v271.type - 5121) >> 1), v275);
      }
      else {
       v97.drawArraysInstancedANGLE(0, v273, v274, v275);
      }
     }
     else if (v275 < 0) {
      if (v271) {
       v8.drawElements(0, v274, v271.type, v273 << ((v271.type - 5121) >> 1));
      }
      else {
       v8.drawArrays(0, v273, v274);
      }
     }
     v3.dirty = true;
     v15.setVAO(null);
     v2.viewportWidth = v88;
     v2.viewportHeight = v89;
     if (v95) {
      $1.cpuTime += performance.now() - v96;
     }
     if (v99) {
      v1.destroyStream(v100);
     }
     if (v116) {
      v1.destroyStream(v117);
     }
     if (v133) {
      v1.destroyStream(v134);
     }
     if (v150) {
      v1.destroyStream(v151);
     }
     if (v167) {
      v1.destroyStream(v168);
     }
     if (v184) {
      v1.destroyStream(v185);
     }
     if (v201) {
      v1.destroyStream(v202);
     }
     if (v218) {
      v1.destroyStream(v219);
     }
     if (v235) {
      v1.destroyStream(v236);
     }
     $13.unbind();
     v269.unbind();
     if (v272) {
      v5.destroyStream(v271);
     }
    }
   }
   , 'scope': function (a0, a1, a2) {
    var v276, v277, v278, v279, v280, v281, v282, v283, v284, v285, v286, v287, v288, v289, v290, v291, v292, v293, v294, v295, v296, v297, v298, v299, v300, v301, v302, v303, v304, v305, v306, v307, v308, v309, v310, v311, v312, v313, v314, v315, v316, v317, v318, v319, v320, v321, v322, v323, v324, v325, v326, v327, v328, v329, v330, v331, v332, v333, v334, v335, v336, v337, v338, v339, v340, v341, v342, v343, v344, v345, v346, v347, v348, v349, v350, v351, v352, v353, v354, v355, v356, v357, v358, v359, v360, v361, v362, v363, v364, v365, v366, v367, v368, v369, v370, v371, v372, v373, v374, v375, v376, v377, v378, v379, v380, v381, v382, v383, v384, v385, v386, v387, v388, v389, v390, v391, v392, v393, v394, v395, v396, v397, v398, v399, v400, v401, v402, v403, v404, v405, v406, v407, v408, v409, v410, v411, v412, v413, v414, v415, v416, v417, v418, v419, v420, v421, v422, v423, v424, v425, v426, v427, v428, v429, v430, v431, v432, v433, v434, v435, v436, v437, v438, v439, v440, v441, v442, v443, v444, v445, v446, v447, v448, v449, v450, v451, v452, v453, v454, v455, v456, v457, v458, v459, v460, v461, v462, v463, v464, v465, v466, v467, v468, v469, v470, v471, v472, v473, v474, v475, v476, v477, v478, v479, v480, v481, v482, v483, v484, v485, v486, v487, v488, v489, v490, v491, v492, v493, v494, v495, v496, v497, v498, v499, v500, v501, v502, v503, v504, v505, v506, v507, v508, v509, v510, v511, v512, v513, v514, v515, v516, v517, v518, v519, v520, v521, v522, v523, v524, v525, v526, v527, v528, v529, v530, v531, v532, v533, v534, v535, v536, v537, v538, v539, v540, v541, v542, v543, v544, v545, v546, v547, v548, v549, v550, v551, v552, v553, v554, v555, v556, v557, v558, v559, v560, v561, v562, v563, v564, v565, v566, v567, v568, v569, v570, v571, v572;
    v276 = a0['viewport'];
    v277 = v276.x | 0;
    v278 = v276.y | 0;
    v279 = 'width' in v276 ? v276.width | 0 : (v2.framebufferWidth - v277);
    v280 = 'height' in v276 ? v276.height | 0 : (v2.framebufferHeight - v278);
    v281 = v2.viewportWidth;
    v2.viewportWidth = v279;
    v282 = v2.viewportHeight;
    v2.viewportHeight = v280;
    v283 = v38[0];
    v38[0] = v277;
    v284 = v38[1];
    v38[1] = v278;
    v285 = v38[2];
    v38[2] = v279;
    v286 = v38[3];
    v38[3] = v280;
    v287 = v16[0];
    v16[0] = 0;
    v288 = v16[1];
    v16[1] = 0;
    v289 = v16[2];
    v16[2] = 0;
    v290 = v16[3];
    v16[3] = 1;
    v291 = v10.blend_enable;
    v10.blend_enable = true;
    v292 = v20[0];
    v20[0] = 770;
    v293 = v20[1];
    v20[1] = 771;
    v294 = v20[2];
    v20[2] = 773;
    v295 = v20[3];
    v20[3] = 1;
    v296 = v10.depth_enable;
    v10.depth_enable = false;
    v297 = a0['viewport'];
    v298 = v297.x | 0;
    v299 = v297.y | 0;
    v300 = 'width' in v297 ? v297.width | 0 : (v2.framebufferWidth - v298);
    v301 = 'height' in v297 ? v297.height | 0 : (v2.framebufferHeight - v299);
    v302 = v30[0];
    v30[0] = v298;
    v303 = v30[1];
    v30[1] = v299;
    v304 = v30[2];
    v30[2] = v300;
    v305 = v30[3];
    v30[3] = v301;
    v306 = v10.scissor_enable;
    v10.scissor_enable = true;
    v307 = v10.stencil_enable;
    v10.stencil_enable = false;
    v308 = v3.profile;
    if (v308) {
     v309 = performance.now();
     $1.count++;
    }
    v310 = a0['elements'];
    v311 = null;
    v312 = v9(v310);
    if (v312) {
     v311 = v5.createStream(v310);
    }
    else {
     v311 = v5.getElements(v310);
    }
    v313 = v4.elements;
    v4.elements = v311;
    v314 = a0['offset'];
    v315 = v4.offset;
    v4.offset = v314;
    v316 = a0['count'];
    v317 = v4.count;
    v4.count = v316;
    v318 = v4.primitive;
    v4.primitive = 0;
    v319 = v14[45];
    v14[45] = false;
    v320 = a0['markerTexture'];
    v321 = v14[48];
    v14[48] = v320;
    v322 = a0['opacity'];
    v323 = v14[10];
    v14[10] = v322;
    v324 = $14.call(this, v2, a0, a2);
    v325 = v14[46];
    v14[46] = v324;
    v326 = v14[47];
    v14[47] = $15;
    v327 = v2['pixelRatio'];
    v328 = v14[34];
    v14[34] = v327;
    v329 = a0['scale'];
    v330 = v14[6];
    v14[6] = v329;
    v331 = a0['scaleFract'];
    v332 = v14[7];
    v14[7] = v331;
    v333 = a0['translate'];
    v334 = v14[8];
    v14[8] = v333;
    v335 = a0['translateFract'];
    v336 = v14[9];
    v14[9] = v335;
    v337 = $16.call(this, v2, a0, a2);
    v338 = false;
    v339 = null;
    v340 = 0;
    v341 = false;
    v342 = 0;
    v343 = 0;
    v344 = 1;
    v345 = 0;
    v346 = 5126;
    v347 = 0;
    v348 = 0;
    v349 = 0;
    v350 = 0;
    if (v9(v337)) {
     v338 = true;
     v339 = v1.createStream(34962, v337);
     v346 = v339.dtype;
    }
    else {
     v339 = v1.getBuffer(v337);
     if (v339) {
      v346 = v339.dtype;
     }
     else if ('constant' in v337) {
      v344 = 2;
      if (typeof v337.constant === 'number') {
       v348 = v337.constant;
       v349 = v350 = v347 = 0;
      }
      else {
       v348 = v337.constant.length > 0 ? v337.constant[0] : 0;
       v349 = v337.constant.length > 1 ? v337.constant[1] : 0;
       v350 = v337.constant.length > 2 ? v337.constant[2] : 0;
       v347 = v337.constant.length > 3 ? v337.constant[3] : 0;
      }
     }
     else {
      if (v9(v337.buffer)) {
       v339 = v1.createStream(34962, v337.buffer);
      }
      else {
       v339 = v1.getBuffer(v337.buffer);
      }
      v346 = 'type' in v337 ? v43[v337.type] : v339.dtype;
      v341 = !!v337.normalized;
      v343 = v337.size | 0;
      v342 = v337.offset | 0;
      v345 = v337.stride | 0;
      v340 = v337.divisor | 0;
     }
    }
    v351 = $17.buffer;
    $17.buffer = v339;
    v352 = $17.divisor;
    $17.divisor = v340;
    v353 = $17.normalized;
    $17.normalized = v341;
    v354 = $17.offset;
    $17.offset = v342;
    v355 = $17.size;
    $17.size = v343;
    v356 = $17.state;
    $17.state = v344;
    v357 = $17.stride;
    $17.stride = v345;
    v358 = $17.type;
    $17.type = v346;
    v359 = $17.w;
    $17.w = v347;
    v360 = $17.x;
    $17.x = v348;
    v361 = $17.y;
    $17.y = v349;
    v362 = $17.z;
    $17.z = v350;
    v363 = $18.call(this, v2, a0, a2);
    v364 = false;
    v365 = null;
    v366 = 0;
    v367 = false;
    v368 = 0;
    v369 = 0;
    v370 = 1;
    v371 = 0;
    v372 = 5126;
    v373 = 0;
    v374 = 0;
    v375 = 0;
    v376 = 0;
    if (v9(v363)) {
     v364 = true;
     v365 = v1.createStream(34962, v363);
     v372 = v365.dtype;
    }
    else {
     v365 = v1.getBuffer(v363);
     if (v365) {
      v372 = v365.dtype;
     }
     else if ('constant' in v363) {
      v370 = 2;
      if (typeof v363.constant === 'number') {
       v374 = v363.constant;
       v375 = v376 = v373 = 0;
      }
      else {
       v374 = v363.constant.length > 0 ? v363.constant[0] : 0;
       v375 = v363.constant.length > 1 ? v363.constant[1] : 0;
       v376 = v363.constant.length > 2 ? v363.constant[2] : 0;
       v373 = v363.constant.length > 3 ? v363.constant[3] : 0;
      }
     }
     else {
      if (v9(v363.buffer)) {
       v365 = v1.createStream(34962, v363.buffer);
      }
      else {
       v365 = v1.getBuffer(v363.buffer);
      }
      v372 = 'type' in v363 ? v43[v363.type] : v365.dtype;
      v367 = !!v363.normalized;
      v369 = v363.size | 0;
      v368 = v363.offset | 0;
      v371 = v363.stride | 0;
      v366 = v363.divisor | 0;
     }
    }
    v377 = $19.buffer;
    $19.buffer = v365;
    v378 = $19.divisor;
    $19.divisor = v366;
    v379 = $19.normalized;
    $19.normalized = v367;
    v380 = $19.offset;
    $19.offset = v368;
    v381 = $19.size;
    $19.size = v369;
    v382 = $19.state;
    $19.state = v370;
    v383 = $19.stride;
    $19.stride = v371;
    v384 = $19.type;
    $19.type = v372;
    v385 = $19.w;
    $19.w = v373;
    v386 = $19.x;
    $19.x = v374;
    v387 = $19.y;
    $19.y = v375;
    v388 = $19.z;
    $19.z = v376;
    v389 = $20.call(this, v2, a0, a2);
    v390 = false;
    v391 = null;
    v392 = 0;
    v393 = false;
    v394 = 0;
    v395 = 0;
    v396 = 1;
    v397 = 0;
    v398 = 5126;
    v399 = 0;
    v400 = 0;
    v401 = 0;
    v402 = 0;
    if (v9(v389)) {
     v390 = true;
     v391 = v1.createStream(34962, v389);
     v398 = v391.dtype;
    }
    else {
     v391 = v1.getBuffer(v389);
     if (v391) {
      v398 = v391.dtype;
     }
     else if ('constant' in v389) {
      v396 = 2;
      if (typeof v389.constant === 'number') {
       v400 = v389.constant;
       v401 = v402 = v399 = 0;
      }
      else {
       v400 = v389.constant.length > 0 ? v389.constant[0] : 0;
       v401 = v389.constant.length > 1 ? v389.constant[1] : 0;
       v402 = v389.constant.length > 2 ? v389.constant[2] : 0;
       v399 = v389.constant.length > 3 ? v389.constant[3] : 0;
      }
     }
     else {
      if (v9(v389.buffer)) {
       v391 = v1.createStream(34962, v389.buffer);
      }
      else {
       v391 = v1.getBuffer(v389.buffer);
      }
      v398 = 'type' in v389 ? v43[v389.type] : v391.dtype;
      v393 = !!v389.normalized;
      v395 = v389.size | 0;
      v394 = v389.offset | 0;
      v397 = v389.stride | 0;
      v392 = v389.divisor | 0;
     }
    }
    v403 = $21.buffer;
    $21.buffer = v391;
    v404 = $21.divisor;
    $21.divisor = v392;
    v405 = $21.normalized;
    $21.normalized = v393;
    v406 = $21.offset;
    $21.offset = v394;
    v407 = $21.size;
    $21.size = v395;
    v408 = $21.state;
    $21.state = v396;
    v409 = $21.stride;
    $21.stride = v397;
    v410 = $21.type;
    $21.type = v398;
    v411 = $21.w;
    $21.w = v399;
    v412 = $21.x;
    $21.x = v400;
    v413 = $21.y;
    $21.y = v401;
    v414 = $21.z;
    $21.z = v402;
    v415 = $22.call(this, v2, a0, a2);
    v416 = false;
    v417 = null;
    v418 = 0;
    v419 = false;
    v420 = 0;
    v421 = 0;
    v422 = 1;
    v423 = 0;
    v424 = 5126;
    v425 = 0;
    v426 = 0;
    v427 = 0;
    v428 = 0;
    if (v9(v415)) {
     v416 = true;
     v417 = v1.createStream(34962, v415);
     v424 = v417.dtype;
    }
    else {
     v417 = v1.getBuffer(v415);
     if (v417) {
      v424 = v417.dtype;
     }
     else if ('constant' in v415) {
      v422 = 2;
      if (typeof v415.constant === 'number') {
       v426 = v415.constant;
       v427 = v428 = v425 = 0;
      }
      else {
       v426 = v415.constant.length > 0 ? v415.constant[0] : 0;
       v427 = v415.constant.length > 1 ? v415.constant[1] : 0;
       v428 = v415.constant.length > 2 ? v415.constant[2] : 0;
       v425 = v415.constant.length > 3 ? v415.constant[3] : 0;
      }
     }
     else {
      if (v9(v415.buffer)) {
       v417 = v1.createStream(34962, v415.buffer);
      }
      else {
       v417 = v1.getBuffer(v415.buffer);
      }
      v424 = 'type' in v415 ? v43[v415.type] : v417.dtype;
      v419 = !!v415.normalized;
      v421 = v415.size | 0;
      v420 = v415.offset | 0;
      v423 = v415.stride | 0;
      v418 = v415.divisor | 0;
     }
    }
    v429 = $23.buffer;
    $23.buffer = v417;
    v430 = $23.divisor;
    $23.divisor = v418;
    v431 = $23.normalized;
    $23.normalized = v419;
    v432 = $23.offset;
    $23.offset = v420;
    v433 = $23.size;
    $23.size = v421;
    v434 = $23.state;
    $23.state = v422;
    v435 = $23.stride;
    $23.stride = v423;
    v436 = $23.type;
    $23.type = v424;
    v437 = $23.w;
    $23.w = v425;
    v438 = $23.x;
    $23.x = v426;
    v439 = $23.y;
    $23.y = v427;
    v440 = $23.z;
    $23.z = v428;
    v441 = $24.call(this, v2, a0, a2);
    v442 = false;
    v443 = null;
    v444 = 0;
    v445 = false;
    v446 = 0;
    v447 = 0;
    v448 = 1;
    v449 = 0;
    v450 = 5126;
    v451 = 0;
    v452 = 0;
    v453 = 0;
    v454 = 0;
    if (v9(v441)) {
     v442 = true;
     v443 = v1.createStream(34962, v441);
     v450 = v443.dtype;
    }
    else {
     v443 = v1.getBuffer(v441);
     if (v443) {
      v450 = v443.dtype;
     }
     else if ('constant' in v441) {
      v448 = 2;
      if (typeof v441.constant === 'number') {
       v452 = v441.constant;
       v453 = v454 = v451 = 0;
      }
      else {
       v452 = v441.constant.length > 0 ? v441.constant[0] : 0;
       v453 = v441.constant.length > 1 ? v441.constant[1] : 0;
       v454 = v441.constant.length > 2 ? v441.constant[2] : 0;
       v451 = v441.constant.length > 3 ? v441.constant[3] : 0;
      }
     }
     else {
      if (v9(v441.buffer)) {
       v443 = v1.createStream(34962, v441.buffer);
      }
      else {
       v443 = v1.getBuffer(v441.buffer);
      }
      v450 = 'type' in v441 ? v43[v441.type] : v443.dtype;
      v445 = !!v441.normalized;
      v447 = v441.size | 0;
      v446 = v441.offset | 0;
      v449 = v441.stride | 0;
      v444 = v441.divisor | 0;
     }
    }
    v455 = $25.buffer;
    $25.buffer = v443;
    v456 = $25.divisor;
    $25.divisor = v444;
    v457 = $25.normalized;
    $25.normalized = v445;
    v458 = $25.offset;
    $25.offset = v446;
    v459 = $25.size;
    $25.size = v447;
    v460 = $25.state;
    $25.state = v448;
    v461 = $25.stride;
    $25.stride = v449;
    v462 = $25.type;
    $25.type = v450;
    v463 = $25.w;
    $25.w = v451;
    v464 = $25.x;
    $25.x = v452;
    v465 = $25.y;
    $25.y = v453;
    v466 = $25.z;
    $25.z = v454;
    v467 = $26.call(this, v2, a0, a2);
    v468 = false;
    v469 = null;
    v470 = 0;
    v471 = false;
    v472 = 0;
    v473 = 0;
    v474 = 1;
    v475 = 0;
    v476 = 5126;
    v477 = 0;
    v478 = 0;
    v479 = 0;
    v480 = 0;
    if (v9(v467)) {
     v468 = true;
     v469 = v1.createStream(34962, v467);
     v476 = v469.dtype;
    }
    else {
     v469 = v1.getBuffer(v467);
     if (v469) {
      v476 = v469.dtype;
     }
     else if ('constant' in v467) {
      v474 = 2;
      if (typeof v467.constant === 'number') {
       v478 = v467.constant;
       v479 = v480 = v477 = 0;
      }
      else {
       v478 = v467.constant.length > 0 ? v467.constant[0] : 0;
       v479 = v467.constant.length > 1 ? v467.constant[1] : 0;
       v480 = v467.constant.length > 2 ? v467.constant[2] : 0;
       v477 = v467.constant.length > 3 ? v467.constant[3] : 0;
      }
     }
     else {
      if (v9(v467.buffer)) {
       v469 = v1.createStream(34962, v467.buffer);
      }
      else {
       v469 = v1.getBuffer(v467.buffer);
      }
      v476 = 'type' in v467 ? v43[v467.type] : v469.dtype;
      v471 = !!v467.normalized;
      v473 = v467.size | 0;
      v472 = v467.offset | 0;
      v475 = v467.stride | 0;
      v470 = v467.divisor | 0;
     }
    }
    v481 = $27.buffer;
    $27.buffer = v469;
    v482 = $27.divisor;
    $27.divisor = v470;
    v483 = $27.normalized;
    $27.normalized = v471;
    v484 = $27.offset;
    $27.offset = v472;
    v485 = $27.size;
    $27.size = v473;
    v486 = $27.state;
    $27.state = v474;
    v487 = $27.stride;
    $27.stride = v475;
    v488 = $27.type;
    $27.type = v476;
    v489 = $27.w;
    $27.w = v477;
    v490 = $27.x;
    $27.x = v478;
    v491 = $27.y;
    $27.y = v479;
    v492 = $27.z;
    $27.z = v480;
    v493 = $28.call(this, v2, a0, a2);
    v494 = false;
    v495 = null;
    v496 = 0;
    v497 = false;
    v498 = 0;
    v499 = 0;
    v500 = 1;
    v501 = 0;
    v502 = 5126;
    v503 = 0;
    v504 = 0;
    v505 = 0;
    v506 = 0;
    if (v9(v493)) {
     v494 = true;
     v495 = v1.createStream(34962, v493);
     v502 = v495.dtype;
    }
    else {
     v495 = v1.getBuffer(v493);
     if (v495) {
      v502 = v495.dtype;
     }
     else if ('constant' in v493) {
      v500 = 2;
      if (typeof v493.constant === 'number') {
       v504 = v493.constant;
       v505 = v506 = v503 = 0;
      }
      else {
       v504 = v493.constant.length > 0 ? v493.constant[0] : 0;
       v505 = v493.constant.length > 1 ? v493.constant[1] : 0;
       v506 = v493.constant.length > 2 ? v493.constant[2] : 0;
       v503 = v493.constant.length > 3 ? v493.constant[3] : 0;
      }
     }
     else {
      if (v9(v493.buffer)) {
       v495 = v1.createStream(34962, v493.buffer);
      }
      else {
       v495 = v1.getBuffer(v493.buffer);
      }
      v502 = 'type' in v493 ? v43[v493.type] : v495.dtype;
      v497 = !!v493.normalized;
      v499 = v493.size | 0;
      v498 = v493.offset | 0;
      v501 = v493.stride | 0;
      v496 = v493.divisor | 0;
     }
    }
    v507 = $29.buffer;
    $29.buffer = v495;
    v508 = $29.divisor;
    $29.divisor = v496;
    v509 = $29.normalized;
    $29.normalized = v497;
    v510 = $29.offset;
    $29.offset = v498;
    v511 = $29.size;
    $29.size = v499;
    v512 = $29.state;
    $29.state = v500;
    v513 = $29.stride;
    $29.stride = v501;
    v514 = $29.type;
    $29.type = v502;
    v515 = $29.w;
    $29.w = v503;
    v516 = $29.x;
    $29.x = v504;
    v517 = $29.y;
    $29.y = v505;
    v518 = $29.z;
    $29.z = v506;
    v519 = $30.call(this, v2, a0, a2);
    v520 = false;
    v521 = null;
    v522 = 0;
    v523 = false;
    v524 = 0;
    v525 = 0;
    v526 = 1;
    v527 = 0;
    v528 = 5126;
    v529 = 0;
    v530 = 0;
    v531 = 0;
    v532 = 0;
    if (v9(v519)) {
     v520 = true;
     v521 = v1.createStream(34962, v519);
     v528 = v521.dtype;
    }
    else {
     v521 = v1.getBuffer(v519);
     if (v521) {
      v528 = v521.dtype;
     }
     else if ('constant' in v519) {
      v526 = 2;
      if (typeof v519.constant === 'number') {
       v530 = v519.constant;
       v531 = v532 = v529 = 0;
      }
      else {
       v530 = v519.constant.length > 0 ? v519.constant[0] : 0;
       v531 = v519.constant.length > 1 ? v519.constant[1] : 0;
       v532 = v519.constant.length > 2 ? v519.constant[2] : 0;
       v529 = v519.constant.length > 3 ? v519.constant[3] : 0;
      }
     }
     else {
      if (v9(v519.buffer)) {
       v521 = v1.createStream(34962, v519.buffer);
      }
      else {
       v521 = v1.getBuffer(v519.buffer);
      }
      v528 = 'type' in v519 ? v43[v519.type] : v521.dtype;
      v523 = !!v519.normalized;
      v525 = v519.size | 0;
      v524 = v519.offset | 0;
      v527 = v519.stride | 0;
      v522 = v519.divisor | 0;
     }
    }
    v533 = $31.buffer;
    $31.buffer = v521;
    v534 = $31.divisor;
    $31.divisor = v522;
    v535 = $31.normalized;
    $31.normalized = v523;
    v536 = $31.offset;
    $31.offset = v524;
    v537 = $31.size;
    $31.size = v525;
    v538 = $31.state;
    $31.state = v526;
    v539 = $31.stride;
    $31.stride = v527;
    v540 = $31.type;
    $31.type = v528;
    v541 = $31.w;
    $31.w = v529;
    v542 = $31.x;
    $31.x = v530;
    v543 = $31.y;
    $31.y = v531;
    v544 = $31.z;
    $31.z = v532;
    v545 = $32.call(this, v2, a0, a2);
    v546 = false;
    v547 = null;
    v548 = 0;
    v549 = false;
    v550 = 0;
    v551 = 0;
    v552 = 1;
    v553 = 0;
    v554 = 5126;
    v555 = 0;
    v556 = 0;
    v557 = 0;
    v558 = 0;
    if (v9(v545)) {
     v546 = true;
     v547 = v1.createStream(34962, v545);
     v554 = v547.dtype;
    }
    else {
     v547 = v1.getBuffer(v545);
     if (v547) {
      v554 = v547.dtype;
     }
     else if ('constant' in v545) {
      v552 = 2;
      if (typeof v545.constant === 'number') {
       v556 = v545.constant;
       v557 = v558 = v555 = 0;
      }
      else {
       v556 = v545.constant.length > 0 ? v545.constant[0] : 0;
       v557 = v545.constant.length > 1 ? v545.constant[1] : 0;
       v558 = v545.constant.length > 2 ? v545.constant[2] : 0;
       v555 = v545.constant.length > 3 ? v545.constant[3] : 0;
      }
     }
     else {
      if (v9(v545.buffer)) {
       v547 = v1.createStream(34962, v545.buffer);
      }
      else {
       v547 = v1.getBuffer(v545.buffer);
      }
      v554 = 'type' in v545 ? v43[v545.type] : v547.dtype;
      v549 = !!v545.normalized;
      v551 = v545.size | 0;
      v550 = v545.offset | 0;
      v553 = v545.stride | 0;
      v548 = v545.divisor | 0;
     }
    }
    v559 = $33.buffer;
    $33.buffer = v547;
    v560 = $33.divisor;
    $33.divisor = v548;
    v561 = $33.normalized;
    $33.normalized = v549;
    v562 = $33.offset;
    $33.offset = v550;
    v563 = $33.size;
    $33.size = v551;
    v564 = $33.state;
    $33.state = v552;
    v565 = $33.stride;
    $33.stride = v553;
    v566 = $33.type;
    $33.type = v554;
    v567 = $33.w;
    $33.w = v555;
    v568 = $33.x;
    $33.x = v556;
    v569 = $33.y;
    $33.y = v557;
    v570 = $33.z;
    $33.z = v558;
    v571 = v11.vert;
    v11.vert = 44;
    v572 = v11.frag;
    v11.frag = 43;
    v3.dirty = true;
    a1(v2, a0, a2);
    v2.viewportWidth = v281;
    v2.viewportHeight = v282;
    v38[0] = v283;
    v38[1] = v284;
    v38[2] = v285;
    v38[3] = v286;
    v16[0] = v287;
    v16[1] = v288;
    v16[2] = v289;
    v16[3] = v290;
    v10.blend_enable = v291;
    v20[0] = v292;
    v20[1] = v293;
    v20[2] = v294;
    v20[3] = v295;
    v10.depth_enable = v296;
    v30[0] = v302;
    v30[1] = v303;
    v30[2] = v304;
    v30[3] = v305;
    v10.scissor_enable = v306;
    v10.stencil_enable = v307;
    if (v308) {
     $1.cpuTime += performance.now() - v309;
    }
    if (v312) {
     v5.destroyStream(v311);
    }
    v4.elements = v313;
    v4.offset = v315;
    v4.count = v317;
    v4.primitive = v318;
    v14[45] = v319;
    v14[48] = v321;
    v14[10] = v323;
    v14[46] = v325;
    v14[47] = v326;
    v14[34] = v328;
    v14[6] = v330;
    v14[7] = v332;
    v14[8] = v334;
    v14[9] = v336;
    if (v338) {
     v1.destroyStream(v339);
    }
    $17.buffer = v351;
    $17.divisor = v352;
    $17.normalized = v353;
    $17.offset = v354;
    $17.size = v355;
    $17.state = v356;
    $17.stride = v357;
    $17.type = v358;
    $17.w = v359;
    $17.x = v360;
    $17.y = v361;
    $17.z = v362;
    if (v364) {
     v1.destroyStream(v365);
    }
    $19.buffer = v377;
    $19.divisor = v378;
    $19.normalized = v379;
    $19.offset = v380;
    $19.size = v381;
    $19.state = v382;
    $19.stride = v383;
    $19.type = v384;
    $19.w = v385;
    $19.x = v386;
    $19.y = v387;
    $19.z = v388;
    if (v390) {
     v1.destroyStream(v391);
    }
    $21.buffer = v403;
    $21.divisor = v404;
    $21.normalized = v405;
    $21.offset = v406;
    $21.size = v407;
    $21.state = v408;
    $21.stride = v409;
    $21.type = v410;
    $21.w = v411;
    $21.x = v412;
    $21.y = v413;
    $21.z = v414;
    if (v416) {
     v1.destroyStream(v417);
    }
    $23.buffer = v429;
    $23.divisor = v430;
    $23.normalized = v431;
    $23.offset = v432;
    $23.size = v433;
    $23.state = v434;
    $23.stride = v435;
    $23.type = v436;
    $23.w = v437;
    $23.x = v438;
    $23.y = v439;
    $23.z = v440;
    if (v442) {
     v1.destroyStream(v443);
    }
    $25.buffer = v455;
    $25.divisor = v456;
    $25.normalized = v457;
    $25.offset = v458;
    $25.size = v459;
    $25.state = v460;
    $25.stride = v461;
    $25.type = v462;
    $25.w = v463;
    $25.x = v464;
    $25.y = v465;
    $25.z = v466;
    if (v468) {
     v1.destroyStream(v469);
    }
    $27.buffer = v481;
    $27.divisor = v482;
    $27.normalized = v483;
    $27.offset = v484;
    $27.size = v485;
    $27.state = v486;
    $27.stride = v487;
    $27.type = v488;
    $27.w = v489;
    $27.x = v490;
    $27.y = v491;
    $27.z = v492;
    if (v494) {
     v1.destroyStream(v495);
    }
    $29.buffer = v507;
    $29.divisor = v508;
    $29.normalized = v509;
    $29.offset = v510;
    $29.size = v511;
    $29.state = v512;
    $29.stride = v513;
    $29.type = v514;
    $29.w = v515;
    $29.x = v516;
    $29.y = v517;
    $29.z = v518;
    if (v520) {
     v1.destroyStream(v521);
    }
    $31.buffer = v533;
    $31.divisor = v534;
    $31.normalized = v535;
    $31.offset = v536;
    $31.size = v537;
    $31.state = v538;
    $31.stride = v539;
    $31.type = v540;
    $31.w = v541;
    $31.x = v542;
    $31.y = v543;
    $31.z = v544;
    if (v546) {
     v1.destroyStream(v547);
    }
    $33.buffer = v559;
    $33.divisor = v560;
    $33.normalized = v561;
    $33.offset = v562;
    $33.size = v563;
    $33.state = v564;
    $33.stride = v565;
    $33.type = v566;
    $33.w = v567;
    $33.x = v568;
    $33.y = v569;
    $33.z = v570;
    v11.vert = v571;
    v11.frag = v572;
    v3.dirty = true;
   }
   ,
  }

 },
 '$45,borderColorId,borderSize,colorId,constPointSize,isActive,opacity,paletteSize,paletteTexture,pixelRatio,scale,scaleFract,size,translate,translateFract,x,xFract,y,yFract': function ($0, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, borderColorId, borderSize, colorId, constPointSize, isActive, opacity, paletteSize, paletteTexture, pixelRatio, scale, scaleFract, size, translate, translateFract, x, xFract, y, yFract
 ) {
  'use strict';
  var v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15, v16, v17, v18, v19, v20, v21, v22, v23, v24, v25, v26, v27, v28, v29, v30, v31, v32, v33, v34, v35, v36, v37, v38, v39, v40, v41, v42, v43, v44, v45, v46;
  v0 = $0.attributes;
  v1 = $0.buffer;
  v2 = $0.context;
  v3 = $0.current;
  v4 = $0.draw;
  v5 = $0.elements;
  v6 = $0.extensions;
  v7 = $0.framebuffer;
  v8 = $0.gl;
  v9 = $0.isBufferArgs;
  v10 = $0.next;
  v11 = $0.shader;
  v12 = $0.strings;
  v13 = $0.timer;
  v14 = $0.uniforms;
  v15 = $0.vao;
  v16 = v10.blend_color;
  v17 = v3.blend_color;
  v18 = v10.blend_equation;
  v19 = v3.blend_equation;
  v20 = v10.blend_func;
  v21 = v3.blend_func;
  v22 = v10.colorMask;
  v23 = v3.colorMask;
  v24 = v10.depth_range;
  v25 = v3.depth_range;
  v26 = v10.polygonOffset_offset;
  v27 = v3.polygonOffset_offset;
  v28 = v10.sample_coverage;
  v29 = v3.sample_coverage;
  v30 = v10.scissor_box;
  v31 = v3.scissor_box;
  v32 = v10.stencil_func;
  v33 = v3.stencil_func;
  v34 = v10.stencil_opBack;
  v35 = v3.stencil_opBack;
  v36 = v10.stencil_opFront;
  v37 = v3.stencil_opFront;
  v38 = v10.viewport;
  v39 = v3.viewport;
  v40 = {
   'add': 32774, 'subtract': 32778, 'reverse subtract': 32779
  }
   ;
  v41 = {
   '0': 0, '1': 1, 'zero': 0, 'one': 1, 'src color': 768, 'one minus src color': 769, 'src alpha': 770, 'one minus src alpha': 771, 'dst color': 774, 'one minus dst color': 775, 'dst alpha': 772, 'one minus dst alpha': 773, 'constant color': 32769, 'one minus constant color': 32770, 'constant alpha': 32771, 'one minus constant alpha': 32772, 'src alpha saturate': 776
  }
   ;
  v42 = {
   'never': 512, 'less': 513, '<': 513, 'equal': 514, '=': 514, '==': 514, '===': 514, 'lequal': 515, '<=': 515, 'greater': 516, '>': 516, 'notequal': 517, '!=': 517, '!==': 517, 'gequal': 518, '>=': 518, 'always': 519
  }
   ;
  v43 = {
   'int8': 5120, 'int16': 5122, 'int32': 5124, 'uint8': 5121, 'uint16': 5123, 'uint32': 5125, 'float': 5126, 'float32': 5126
  }
   ;
  v44 = {
   'cw': 2304, 'ccw': 2305
  }
   ;
  v45 = {
   'points': 0, 'point': 0, 'lines': 1, 'line': 1, 'triangles': 4, 'triangle': 4, 'line loop': 2, 'line strip': 3, 'triangle strip': 5, 'triangle fan': 6
  }
   ;
  v46 = {
   '0': 0, 'zero': 0, 'keep': 7680, 'replace': 7681, 'increment': 7682, 'decrement': 7683, 'increment wrap': 34055, 'decrement wrap': 34056, 'invert': 5386
  }
   ;
  return {
   'batch': function (a0, a1) {
    var v571, v572, v607, v608, v609, v610, v611;
    v571 = v6.angle_instanced_arrays;
    v572 = v7.next;
    if (v572 !== v7.cur) {
     if (v572) {
      v8.bindFramebuffer(36160, v572.framebuffer);
     }
     else {
      v8.bindFramebuffer(36160, null);
     }
     v7.cur = v572;
    }
    if (v3.dirty) {
     var v573, v574, v575, v576, v577, v578, v579, v580, v581, v582, v583, v584, v585, v586, v587, v588, v589, v590, v591, v592, v593, v594, v595, v596, v597, v598, v599, v600, v601, v602, v603, v604, v605, v606;
     v573 = v10.dither;
     if (v573 !== v3.dither) {
      if (v573) {
       v8.enable(3024);
      }
      else {
       v8.disable(3024);
      }
      v3.dither = v573;
     }
     v574 = v18[0];
     v575 = v18[1];
     if (v574 !== v19[0] || v575 !== v19[1]) {
      v8.blendEquationSeparate(v574, v575);
      v19[0] = v574;
      v19[1] = v575;
     }
     v576 = v10.depth_func;
     if (v576 !== v3.depth_func) {
      v8.depthFunc(v576);
      v3.depth_func = v576;
     }
     v577 = v24[0];
     v578 = v24[1];
     if (v577 !== v25[0] || v578 !== v25[1]) {
      v8.depthRange(v577, v578);
      v25[0] = v577;
      v25[1] = v578;
     }
     v579 = v10.depth_mask;
     if (v579 !== v3.depth_mask) {
      v8.depthMask(v579);
      v3.depth_mask = v579;
     }
     v580 = v22[0];
     v581 = v22[1];
     v582 = v22[2];
     v583 = v22[3];
     if (v580 !== v23[0] || v581 !== v23[1] || v582 !== v23[2] || v583 !== v23[3]) {
      v8.colorMask(v580, v581, v582, v583);
      v23[0] = v580;
      v23[1] = v581;
      v23[2] = v582;
      v23[3] = v583;
     }
     v584 = v10.cull_enable;
     if (v584 !== v3.cull_enable) {
      if (v584) {
       v8.enable(2884);
      }
      else {
       v8.disable(2884);
      }
      v3.cull_enable = v584;
     }
     v585 = v10.cull_face;
     if (v585 !== v3.cull_face) {
      v8.cullFace(v585);
      v3.cull_face = v585;
     }
     v586 = v10.frontFace;
     if (v586 !== v3.frontFace) {
      v8.frontFace(v586);
      v3.frontFace = v586;
     }
     v587 = v10.lineWidth;
     if (v587 !== v3.lineWidth) {
      v8.lineWidth(v587);
      v3.lineWidth = v587;
     }
     v588 = v10.polygonOffset_enable;
     if (v588 !== v3.polygonOffset_enable) {
      if (v588) {
       v8.enable(32823);
      }
      else {
       v8.disable(32823);
      }
      v3.polygonOffset_enable = v588;
     }
     v589 = v26[0];
     v590 = v26[1];
     if (v589 !== v27[0] || v590 !== v27[1]) {
      v8.polygonOffset(v589, v590);
      v27[0] = v589;
      v27[1] = v590;
     }
     v591 = v10.sample_alpha;
     if (v591 !== v3.sample_alpha) {
      if (v591) {
       v8.enable(32926);
      }
      else {
       v8.disable(32926);
      }
      v3.sample_alpha = v591;
     }
     v592 = v10.sample_enable;
     if (v592 !== v3.sample_enable) {
      if (v592) {
       v8.enable(32928);
      }
      else {
       v8.disable(32928);
      }
      v3.sample_enable = v592;
     }
     v593 = v28[0];
     v594 = v28[1];
     if (v593 !== v29[0] || v594 !== v29[1]) {
      v8.sampleCoverage(v593, v594);
      v29[0] = v593;
      v29[1] = v594;
     }
     v595 = v10.stencil_mask;
     if (v595 !== v3.stencil_mask) {
      v8.stencilMask(v595);
      v3.stencil_mask = v595;
     }
     v596 = v32[0];
     v597 = v32[1];
     v598 = v32[2];
     if (v596 !== v33[0] || v597 !== v33[1] || v598 !== v33[2]) {
      v8.stencilFunc(v596, v597, v598);
      v33[0] = v596;
      v33[1] = v597;
      v33[2] = v598;
     }
     v599 = v36[0];
     v600 = v36[1];
     v601 = v36[2];
     v602 = v36[3];
     if (v599 !== v37[0] || v600 !== v37[1] || v601 !== v37[2] || v602 !== v37[3]) {
      v8.stencilOpSeparate(v599, v600, v601, v602);
      v37[0] = v599;
      v37[1] = v600;
      v37[2] = v601;
      v37[3] = v602;
     }
     v603 = v34[0];
     v604 = v34[1];
     v605 = v34[2];
     v606 = v34[3];
     if (v603 !== v35[0] || v604 !== v35[1] || v605 !== v35[2] || v606 !== v35[3]) {
      v8.stencilOpSeparate(v603, v604, v605, v606);
      v35[0] = v603;
      v35[1] = v604;
      v35[2] = v605;
      v35[3] = v606;
     }
    }
    v8.blendColor(0, 0, 0, 1);
    v17[0] = 0;
    v17[1] = 0;
    v17[2] = 0;
    v17[3] = 1;
    v8.enable(3042);
    v3.blend_enable = true;
    v8.blendFuncSeparate(770, 771, 773, 1);
    v21[0] = 770;
    v21[1] = 771;
    v21[2] = 773;
    v21[3] = 1;
    v8.disable(2929);
    v3.depth_enable = false;
    v8.enable(3089);
    v3.scissor_enable = true;
    v8.disable(2960);
    v3.stencil_enable = false;
    v607 = v3.profile;
    if (v607) {
     v608 = performance.now();
     $1.count += a1;
    }
    v8.useProgram($34.program);
    v609 = v6.angle_instanced_arrays;
    var v811;
    v15.setVAO(null);
    v8.uniform1i(constPointSize.location, false);
    v8.uniform1i(paletteTexture.location, $44.bind());
    v811 = v4.instances;
    for (v610 = 0;
     v610 < a1;
     ++v610) {
     v611 = a0[v610];
     var v612, v613, v614, v615, v616, v617, v618, v619, v620, v621, v622, v623, v624, v625, v626, v627, v628, v629, v630, v631, v632, v633, v634, v635, v636, v637, v638, v639, v640, v641, v642, v643, v644, v645, v646, v647, v648, v649, v650, v651, v652, v653, v654, v655, v656, v657, v658, v659, v660, v661, v662, v663, v664, v665, v666, v667, v668, v669, v670, v671, v672, v673, v674, v675, v676, v677, v678, v679, v680, v681, v682, v683, v684, v685, v686, v687, v688, v689, v690, v691, v692, v693, v694, v695, v696, v697, v698, v699, v700, v701, v702, v703, v704, v705, v706, v707, v708, v709, v710, v711, v712, v713, v714, v715, v716, v717, v718, v719, v720, v721, v722, v723, v724, v725, v726, v727, v728, v729, v730, v731, v732, v733, v734, v735, v736, v737, v738, v739, v740, v741, v742, v743, v744, v745, v746, v747, v748, v749, v750, v751, v752, v753, v754, v755, v756, v757, v758, v759, v760, v761, v762, v763, v764, v765, v766, v767, v768, v769, v770, v771, v772, v773, v774, v775, v776, v777, v778, v779, v780, v781, v782, v783, v784, v785, v786, v787, v788, v789, v790, v791, v792, v793, v794, v795, v796, v797, v798, v799, v800, v801, v802, v803, v804, v805, v806, v807, v808, v809, v810;
     v612 = v611['viewport'];
     v613 = v612.x | 0;
     v614 = v612.y | 0;
     v615 = 'width' in v612 ? v612.width | 0 : (v2.framebufferWidth - v613);
     v616 = 'height' in v612 ? v612.height | 0 : (v2.framebufferHeight - v614);
     v617 = v2.viewportWidth;
     v2.viewportWidth = v615;
     v618 = v2.viewportHeight;
     v2.viewportHeight = v616;
     v8.viewport(v613, v614, v615, v616);
     v39[0] = v613;
     v39[1] = v614;
     v39[2] = v615;
     v39[3] = v616;
     v619 = v611['viewport'];
     v620 = v619.x | 0;
     v621 = v619.y | 0;
     v622 = 'width' in v619 ? v619.width | 0 : (v2.framebufferWidth - v620);
     v623 = 'height' in v619 ? v619.height | 0 : (v2.framebufferHeight - v621);
     v8.scissor(v620, v621, v622, v623);
     v31[0] = v620;
     v31[1] = v621;
     v31[2] = v622;
     v31[3] = v623;
     v624 = $35.call(this, v2, v611, v610);
     v625 = false;
     v626 = null;
     v627 = 0;
     v628 = false;
     v629 = 0;
     v630 = 0;
     v631 = 1;
     v632 = 0;
     v633 = 5126;
     v634 = 0;
     v635 = 0;
     v636 = 0;
     v637 = 0;
     if (v9(v624)) {
      v625 = true;
      v626 = v1.createStream(34962, v624);
      v633 = v626.dtype;
     }
     else {
      v626 = v1.getBuffer(v624);
      if (v626) {
       v633 = v626.dtype;
      }
      else if ('constant' in v624) {
       v631 = 2;
       if (typeof v624.constant === 'number') {
        v635 = v624.constant;
        v636 = v637 = v634 = 0;
       }
       else {
        v635 = v624.constant.length > 0 ? v624.constant[0] : 0;
        v636 = v624.constant.length > 1 ? v624.constant[1] : 0;
        v637 = v624.constant.length > 2 ? v624.constant[2] : 0;
        v634 = v624.constant.length > 3 ? v624.constant[3] : 0;
       }
      }
      else {
       if (v9(v624.buffer)) {
        v626 = v1.createStream(34962, v624.buffer);
       }
       else {
        v626 = v1.getBuffer(v624.buffer);
       }
       v633 = 'type' in v624 ? v43[v624.type] : v626.dtype;
       v628 = !!v624.normalized;
       v630 = v624.size | 0;
       v629 = v624.offset | 0;
       v632 = v624.stride | 0;
       v627 = v624.divisor | 0;
      }
     }
     v638 = x.location;
     v639 = v0[v638];
     if (v631 === 1) {
      if (!v639.buffer) {
       v8.enableVertexAttribArray(v638);
      }
      v640 = v630 || 1;
      if (v639.type !== v633 || v639.size !== v640 || v639.buffer !== v626 || v639.normalized !== v628 || v639.offset !== v629 || v639.stride !== v632) {
       v8.bindBuffer(34962, v626.buffer);
       v8.vertexAttribPointer(v638, v640, v633, v628, v632, v629);
       v639.type = v633;
       v639.size = v640;
       v639.buffer = v626;
       v639.normalized = v628;
       v639.offset = v629;
       v639.stride = v632;
      }
      if (v639.divisor !== v627) {
       v609.vertexAttribDivisorANGLE(v638, v627);
       v639.divisor = v627;
      }
     }
     else {
      if (v639.buffer) {
       v8.disableVertexAttribArray(v638);
       v639.buffer = null;
      }
      if (v639.x !== v635 || v639.y !== v636 || v639.z !== v637 || v639.w !== v634) {
       v8.vertexAttrib4f(v638, v635, v636, v637, v634);
       v639.x = v635;
       v639.y = v636;
       v639.z = v637;
       v639.w = v634;
      }
     }
     v641 = $36.call(this, v2, v611, v610);
     v642 = false;
     v643 = null;
     v644 = 0;
     v645 = false;
     v646 = 0;
     v647 = 0;
     v648 = 1;
     v649 = 0;
     v650 = 5126;
     v651 = 0;
     v652 = 0;
     v653 = 0;
     v654 = 0;
     if (v9(v641)) {
      v642 = true;
      v643 = v1.createStream(34962, v641);
      v650 = v643.dtype;
     }
     else {
      v643 = v1.getBuffer(v641);
      if (v643) {
       v650 = v643.dtype;
      }
      else if ('constant' in v641) {
       v648 = 2;
       if (typeof v641.constant === 'number') {
        v652 = v641.constant;
        v653 = v654 = v651 = 0;
       }
       else {
        v652 = v641.constant.length > 0 ? v641.constant[0] : 0;
        v653 = v641.constant.length > 1 ? v641.constant[1] : 0;
        v654 = v641.constant.length > 2 ? v641.constant[2] : 0;
        v651 = v641.constant.length > 3 ? v641.constant[3] : 0;
       }
      }
      else {
       if (v9(v641.buffer)) {
        v643 = v1.createStream(34962, v641.buffer);
       }
       else {
        v643 = v1.getBuffer(v641.buffer);
       }
       v650 = 'type' in v641 ? v43[v641.type] : v643.dtype;
       v645 = !!v641.normalized;
       v647 = v641.size | 0;
       v646 = v641.offset | 0;
       v649 = v641.stride | 0;
       v644 = v641.divisor | 0;
      }
     }
     v655 = y.location;
     v656 = v0[v655];
     if (v648 === 1) {
      if (!v656.buffer) {
       v8.enableVertexAttribArray(v655);
      }
      v657 = v647 || 1;
      if (v656.type !== v650 || v656.size !== v657 || v656.buffer !== v643 || v656.normalized !== v645 || v656.offset !== v646 || v656.stride !== v649) {
       v8.bindBuffer(34962, v643.buffer);
       v8.vertexAttribPointer(v655, v657, v650, v645, v649, v646);
       v656.type = v650;
       v656.size = v657;
       v656.buffer = v643;
       v656.normalized = v645;
       v656.offset = v646;
       v656.stride = v649;
      }
      if (v656.divisor !== v644) {
       v609.vertexAttribDivisorANGLE(v655, v644);
       v656.divisor = v644;
      }
     }
     else {
      if (v656.buffer) {
       v8.disableVertexAttribArray(v655);
       v656.buffer = null;
      }
      if (v656.x !== v652 || v656.y !== v653 || v656.z !== v654 || v656.w !== v651) {
       v8.vertexAttrib4f(v655, v652, v653, v654, v651);
       v656.x = v652;
       v656.y = v653;
       v656.z = v654;
       v656.w = v651;
      }
     }
     v658 = $37.call(this, v2, v611, v610);
     v659 = false;
     v660 = null;
     v661 = 0;
     v662 = false;
     v663 = 0;
     v664 = 0;
     v665 = 1;
     v666 = 0;
     v667 = 5126;
     v668 = 0;
     v669 = 0;
     v670 = 0;
     v671 = 0;
     if (v9(v658)) {
      v659 = true;
      v660 = v1.createStream(34962, v658);
      v667 = v660.dtype;
     }
     else {
      v660 = v1.getBuffer(v658);
      if (v660) {
       v667 = v660.dtype;
      }
      else if ('constant' in v658) {
       v665 = 2;
       if (typeof v658.constant === 'number') {
        v669 = v658.constant;
        v670 = v671 = v668 = 0;
       }
       else {
        v669 = v658.constant.length > 0 ? v658.constant[0] : 0;
        v670 = v658.constant.length > 1 ? v658.constant[1] : 0;
        v671 = v658.constant.length > 2 ? v658.constant[2] : 0;
        v668 = v658.constant.length > 3 ? v658.constant[3] : 0;
       }
      }
      else {
       if (v9(v658.buffer)) {
        v660 = v1.createStream(34962, v658.buffer);
       }
       else {
        v660 = v1.getBuffer(v658.buffer);
       }
       v667 = 'type' in v658 ? v43[v658.type] : v660.dtype;
       v662 = !!v658.normalized;
       v664 = v658.size | 0;
       v663 = v658.offset | 0;
       v666 = v658.stride | 0;
       v661 = v658.divisor | 0;
      }
     }
     v672 = xFract.location;
     v673 = v0[v672];
     if (v665 === 1) {
      if (!v673.buffer) {
       v8.enableVertexAttribArray(v672);
      }
      v674 = v664 || 1;
      if (v673.type !== v667 || v673.size !== v674 || v673.buffer !== v660 || v673.normalized !== v662 || v673.offset !== v663 || v673.stride !== v666) {
       v8.bindBuffer(34962, v660.buffer);
       v8.vertexAttribPointer(v672, v674, v667, v662, v666, v663);
       v673.type = v667;
       v673.size = v674;
       v673.buffer = v660;
       v673.normalized = v662;
       v673.offset = v663;
       v673.stride = v666;
      }
      if (v673.divisor !== v661) {
       v609.vertexAttribDivisorANGLE(v672, v661);
       v673.divisor = v661;
      }
     }
     else {
      if (v673.buffer) {
       v8.disableVertexAttribArray(v672);
       v673.buffer = null;
      }
      if (v673.x !== v669 || v673.y !== v670 || v673.z !== v671 || v673.w !== v668) {
       v8.vertexAttrib4f(v672, v669, v670, v671, v668);
       v673.x = v669;
       v673.y = v670;
       v673.z = v671;
       v673.w = v668;
      }
     }
     v675 = $38.call(this, v2, v611, v610);
     v676 = false;
     v677 = null;
     v678 = 0;
     v679 = false;
     v680 = 0;
     v681 = 0;
     v682 = 1;
     v683 = 0;
     v684 = 5126;
     v685 = 0;
     v686 = 0;
     v687 = 0;
     v688 = 0;
     if (v9(v675)) {
      v676 = true;
      v677 = v1.createStream(34962, v675);
      v684 = v677.dtype;
     }
     else {
      v677 = v1.getBuffer(v675);
      if (v677) {
       v684 = v677.dtype;
      }
      else if ('constant' in v675) {
       v682 = 2;
       if (typeof v675.constant === 'number') {
        v686 = v675.constant;
        v687 = v688 = v685 = 0;
       }
       else {
        v686 = v675.constant.length > 0 ? v675.constant[0] : 0;
        v687 = v675.constant.length > 1 ? v675.constant[1] : 0;
        v688 = v675.constant.length > 2 ? v675.constant[2] : 0;
        v685 = v675.constant.length > 3 ? v675.constant[3] : 0;
       }
      }
      else {
       if (v9(v675.buffer)) {
        v677 = v1.createStream(34962, v675.buffer);
       }
       else {
        v677 = v1.getBuffer(v675.buffer);
       }
       v684 = 'type' in v675 ? v43[v675.type] : v677.dtype;
       v679 = !!v675.normalized;
       v681 = v675.size | 0;
       v680 = v675.offset | 0;
       v683 = v675.stride | 0;
       v678 = v675.divisor | 0;
      }
     }
     v689 = yFract.location;
     v690 = v0[v689];
     if (v682 === 1) {
      if (!v690.buffer) {
       v8.enableVertexAttribArray(v689);
      }
      v691 = v681 || 1;
      if (v690.type !== v684 || v690.size !== v691 || v690.buffer !== v677 || v690.normalized !== v679 || v690.offset !== v680 || v690.stride !== v683) {
       v8.bindBuffer(34962, v677.buffer);
       v8.vertexAttribPointer(v689, v691, v684, v679, v683, v680);
       v690.type = v684;
       v690.size = v691;
       v690.buffer = v677;
       v690.normalized = v679;
       v690.offset = v680;
       v690.stride = v683;
      }
      if (v690.divisor !== v678) {
       v609.vertexAttribDivisorANGLE(v689, v678);
       v690.divisor = v678;
      }
     }
     else {
      if (v690.buffer) {
       v8.disableVertexAttribArray(v689);
       v690.buffer = null;
      }
      if (v690.x !== v686 || v690.y !== v687 || v690.z !== v688 || v690.w !== v685) {
       v8.vertexAttrib4f(v689, v686, v687, v688, v685);
       v690.x = v686;
       v690.y = v687;
       v690.z = v688;
       v690.w = v685;
      }
     }
     v692 = $39.call(this, v2, v611, v610);
     v693 = false;
     v694 = null;
     v695 = 0;
     v696 = false;
     v697 = 0;
     v698 = 0;
     v699 = 1;
     v700 = 0;
     v701 = 5126;
     v702 = 0;
     v703 = 0;
     v704 = 0;
     v705 = 0;
     if (v9(v692)) {
      v693 = true;
      v694 = v1.createStream(34962, v692);
      v701 = v694.dtype;
     }
     else {
      v694 = v1.getBuffer(v692);
      if (v694) {
       v701 = v694.dtype;
      }
      else if ('constant' in v692) {
       v699 = 2;
       if (typeof v692.constant === 'number') {
        v703 = v692.constant;
        v704 = v705 = v702 = 0;
       }
       else {
        v703 = v692.constant.length > 0 ? v692.constant[0] : 0;
        v704 = v692.constant.length > 1 ? v692.constant[1] : 0;
        v705 = v692.constant.length > 2 ? v692.constant[2] : 0;
        v702 = v692.constant.length > 3 ? v692.constant[3] : 0;
       }
      }
      else {
       if (v9(v692.buffer)) {
        v694 = v1.createStream(34962, v692.buffer);
       }
       else {
        v694 = v1.getBuffer(v692.buffer);
       }
       v701 = 'type' in v692 ? v43[v692.type] : v694.dtype;
       v696 = !!v692.normalized;
       v698 = v692.size | 0;
       v697 = v692.offset | 0;
       v700 = v692.stride | 0;
       v695 = v692.divisor | 0;
      }
     }
     v706 = size.location;
     v707 = v0[v706];
     if (v699 === 1) {
      if (!v707.buffer) {
       v8.enableVertexAttribArray(v706);
      }
      v708 = v698 || 1;
      if (v707.type !== v701 || v707.size !== v708 || v707.buffer !== v694 || v707.normalized !== v696 || v707.offset !== v697 || v707.stride !== v700) {
       v8.bindBuffer(34962, v694.buffer);
       v8.vertexAttribPointer(v706, v708, v701, v696, v700, v697);
       v707.type = v701;
       v707.size = v708;
       v707.buffer = v694;
       v707.normalized = v696;
       v707.offset = v697;
       v707.stride = v700;
      }
      if (v707.divisor !== v695) {
       v609.vertexAttribDivisorANGLE(v706, v695);
       v707.divisor = v695;
      }
     }
     else {
      if (v707.buffer) {
       v8.disableVertexAttribArray(v706);
       v707.buffer = null;
      }
      if (v707.x !== v703 || v707.y !== v704 || v707.z !== v705 || v707.w !== v702) {
       v8.vertexAttrib4f(v706, v703, v704, v705, v702);
       v707.x = v703;
       v707.y = v704;
       v707.z = v705;
       v707.w = v702;
      }
     }
     v709 = $40.call(this, v2, v611, v610);
     v710 = false;
     v711 = null;
     v712 = 0;
     v713 = false;
     v714 = 0;
     v715 = 0;
     v716 = 1;
     v717 = 0;
     v718 = 5126;
     v719 = 0;
     v720 = 0;
     v721 = 0;
     v722 = 0;
     if (v9(v709)) {
      v710 = true;
      v711 = v1.createStream(34962, v709);
      v718 = v711.dtype;
     }
     else {
      v711 = v1.getBuffer(v709);
      if (v711) {
       v718 = v711.dtype;
      }
      else if ('constant' in v709) {
       v716 = 2;
       if (typeof v709.constant === 'number') {
        v720 = v709.constant;
        v721 = v722 = v719 = 0;
       }
       else {
        v720 = v709.constant.length > 0 ? v709.constant[0] : 0;
        v721 = v709.constant.length > 1 ? v709.constant[1] : 0;
        v722 = v709.constant.length > 2 ? v709.constant[2] : 0;
        v719 = v709.constant.length > 3 ? v709.constant[3] : 0;
       }
      }
      else {
       if (v9(v709.buffer)) {
        v711 = v1.createStream(34962, v709.buffer);
       }
       else {
        v711 = v1.getBuffer(v709.buffer);
       }
       v718 = 'type' in v709 ? v43[v709.type] : v711.dtype;
       v713 = !!v709.normalized;
       v715 = v709.size | 0;
       v714 = v709.offset | 0;
       v717 = v709.stride | 0;
       v712 = v709.divisor | 0;
      }
     }
     v723 = borderSize.location;
     v724 = v0[v723];
     if (v716 === 1) {
      if (!v724.buffer) {
       v8.enableVertexAttribArray(v723);
      }
      v725 = v715 || 1;
      if (v724.type !== v718 || v724.size !== v725 || v724.buffer !== v711 || v724.normalized !== v713 || v724.offset !== v714 || v724.stride !== v717) {
       v8.bindBuffer(34962, v711.buffer);
       v8.vertexAttribPointer(v723, v725, v718, v713, v717, v714);
       v724.type = v718;
       v724.size = v725;
       v724.buffer = v711;
       v724.normalized = v713;
       v724.offset = v714;
       v724.stride = v717;
      }
      if (v724.divisor !== v712) {
       v609.vertexAttribDivisorANGLE(v723, v712);
       v724.divisor = v712;
      }
     }
     else {
      if (v724.buffer) {
       v8.disableVertexAttribArray(v723);
       v724.buffer = null;
      }
      if (v724.x !== v720 || v724.y !== v721 || v724.z !== v722 || v724.w !== v719) {
       v8.vertexAttrib4f(v723, v720, v721, v722, v719);
       v724.x = v720;
       v724.y = v721;
       v724.z = v722;
       v724.w = v719;
      }
     }
     v726 = $41.call(this, v2, v611, v610);
     v727 = false;
     v728 = null;
     v729 = 0;
     v730 = false;
     v731 = 0;
     v732 = 0;
     v733 = 1;
     v734 = 0;
     v735 = 5126;
     v736 = 0;
     v737 = 0;
     v738 = 0;
     v739 = 0;
     if (v9(v726)) {
      v727 = true;
      v728 = v1.createStream(34962, v726);
      v735 = v728.dtype;
     }
     else {
      v728 = v1.getBuffer(v726);
      if (v728) {
       v735 = v728.dtype;
      }
      else if ('constant' in v726) {
       v733 = 2;
       if (typeof v726.constant === 'number') {
        v737 = v726.constant;
        v738 = v739 = v736 = 0;
       }
       else {
        v737 = v726.constant.length > 0 ? v726.constant[0] : 0;
        v738 = v726.constant.length > 1 ? v726.constant[1] : 0;
        v739 = v726.constant.length > 2 ? v726.constant[2] : 0;
        v736 = v726.constant.length > 3 ? v726.constant[3] : 0;
       }
      }
      else {
       if (v9(v726.buffer)) {
        v728 = v1.createStream(34962, v726.buffer);
       }
       else {
        v728 = v1.getBuffer(v726.buffer);
       }
       v735 = 'type' in v726 ? v43[v726.type] : v728.dtype;
       v730 = !!v726.normalized;
       v732 = v726.size | 0;
       v731 = v726.offset | 0;
       v734 = v726.stride | 0;
       v729 = v726.divisor | 0;
      }
     }
     v740 = colorId.location;
     v741 = v0[v740];
     if (v733 === 1) {
      if (!v741.buffer) {
       v8.enableVertexAttribArray(v740);
      }
      v742 = v732 || 4;
      if (v741.type !== v735 || v741.size !== v742 || v741.buffer !== v728 || v741.normalized !== v730 || v741.offset !== v731 || v741.stride !== v734) {
       v8.bindBuffer(34962, v728.buffer);
       v8.vertexAttribPointer(v740, v742, v735, v730, v734, v731);
       v741.type = v735;
       v741.size = v742;
       v741.buffer = v728;
       v741.normalized = v730;
       v741.offset = v731;
       v741.stride = v734;
      }
      if (v741.divisor !== v729) {
       v609.vertexAttribDivisorANGLE(v740, v729);
       v741.divisor = v729;
      }
     }
     else {
      if (v741.buffer) {
       v8.disableVertexAttribArray(v740);
       v741.buffer = null;
      }
      if (v741.x !== v737 || v741.y !== v738 || v741.z !== v739 || v741.w !== v736) {
       v8.vertexAttrib4f(v740, v737, v738, v739, v736);
       v741.x = v737;
       v741.y = v738;
       v741.z = v739;
       v741.w = v736;
      }
     }
     v743 = $42.call(this, v2, v611, v610);
     v744 = false;
     v745 = null;
     v746 = 0;
     v747 = false;
     v748 = 0;
     v749 = 0;
     v750 = 1;
     v751 = 0;
     v752 = 5126;
     v753 = 0;
     v754 = 0;
     v755 = 0;
     v756 = 0;
     if (v9(v743)) {
      v744 = true;
      v745 = v1.createStream(34962, v743);
      v752 = v745.dtype;
     }
     else {
      v745 = v1.getBuffer(v743);
      if (v745) {
       v752 = v745.dtype;
      }
      else if ('constant' in v743) {
       v750 = 2;
       if (typeof v743.constant === 'number') {
        v754 = v743.constant;
        v755 = v756 = v753 = 0;
       }
       else {
        v754 = v743.constant.length > 0 ? v743.constant[0] : 0;
        v755 = v743.constant.length > 1 ? v743.constant[1] : 0;
        v756 = v743.constant.length > 2 ? v743.constant[2] : 0;
        v753 = v743.constant.length > 3 ? v743.constant[3] : 0;
       }
      }
      else {
       if (v9(v743.buffer)) {
        v745 = v1.createStream(34962, v743.buffer);
       }
       else {
        v745 = v1.getBuffer(v743.buffer);
       }
       v752 = 'type' in v743 ? v43[v743.type] : v745.dtype;
       v747 = !!v743.normalized;
       v749 = v743.size | 0;
       v748 = v743.offset | 0;
       v751 = v743.stride | 0;
       v746 = v743.divisor | 0;
      }
     }
     v757 = borderColorId.location;
     v758 = v0[v757];
     if (v750 === 1) {
      if (!v758.buffer) {
       v8.enableVertexAttribArray(v757);
      }
      v759 = v749 || 4;
      if (v758.type !== v752 || v758.size !== v759 || v758.buffer !== v745 || v758.normalized !== v747 || v758.offset !== v748 || v758.stride !== v751) {
       v8.bindBuffer(34962, v745.buffer);
       v8.vertexAttribPointer(v757, v759, v752, v747, v751, v748);
       v758.type = v752;
       v758.size = v759;
       v758.buffer = v745;
       v758.normalized = v747;
       v758.offset = v748;
       v758.stride = v751;
      }
      if (v758.divisor !== v746) {
       v609.vertexAttribDivisorANGLE(v757, v746);
       v758.divisor = v746;
      }
     }
     else {
      if (v758.buffer) {
       v8.disableVertexAttribArray(v757);
       v758.buffer = null;
      }
      if (v758.x !== v754 || v758.y !== v755 || v758.z !== v756 || v758.w !== v753) {
       v8.vertexAttrib4f(v757, v754, v755, v756, v753);
       v758.x = v754;
       v758.y = v755;
       v758.z = v756;
       v758.w = v753;
      }
     }
     v760 = $43.call(this, v2, v611, v610);
     v761 = false;
     v762 = null;
     v763 = 0;
     v764 = false;
     v765 = 0;
     v766 = 0;
     v767 = 1;
     v768 = 0;
     v769 = 5126;
     v770 = 0;
     v771 = 0;
     v772 = 0;
     v773 = 0;
     if (v9(v760)) {
      v761 = true;
      v762 = v1.createStream(34962, v760);
      v769 = v762.dtype;
     }
     else {
      v762 = v1.getBuffer(v760);
      if (v762) {
       v769 = v762.dtype;
      }
      else if ('constant' in v760) {
       v767 = 2;
       if (typeof v760.constant === 'number') {
        v771 = v760.constant;
        v772 = v773 = v770 = 0;
       }
       else {
        v771 = v760.constant.length > 0 ? v760.constant[0] : 0;
        v772 = v760.constant.length > 1 ? v760.constant[1] : 0;
        v773 = v760.constant.length > 2 ? v760.constant[2] : 0;
        v770 = v760.constant.length > 3 ? v760.constant[3] : 0;
       }
      }
      else {
       if (v9(v760.buffer)) {
        v762 = v1.createStream(34962, v760.buffer);
       }
       else {
        v762 = v1.getBuffer(v760.buffer);
       }
       v769 = 'type' in v760 ? v43[v760.type] : v762.dtype;
       v764 = !!v760.normalized;
       v766 = v760.size | 0;
       v765 = v760.offset | 0;
       v768 = v760.stride | 0;
       v763 = v760.divisor | 0;
      }
     }
     v774 = isActive.location;
     v775 = v0[v774];
     if (v767 === 1) {
      if (!v775.buffer) {
       v8.enableVertexAttribArray(v774);
      }
      v776 = v766 || 1;
      if (v775.type !== v769 || v775.size !== v776 || v775.buffer !== v762 || v775.normalized !== v764 || v775.offset !== v765 || v775.stride !== v768) {
       v8.bindBuffer(34962, v762.buffer);
       v8.vertexAttribPointer(v774, v776, v769, v764, v768, v765);
       v775.type = v769;
       v775.size = v776;
       v775.buffer = v762;
       v775.normalized = v764;
       v775.offset = v765;
       v775.stride = v768;
      }
      if (v775.divisor !== v763) {
       v609.vertexAttribDivisorANGLE(v774, v763);
       v775.divisor = v763;
      }
     }
     else {
      if (v775.buffer) {
       v8.disableVertexAttribArray(v774);
       v775.buffer = null;
      }
      if (v775.x !== v771 || v775.y !== v772 || v775.z !== v773 || v775.w !== v770) {
       v8.vertexAttrib4f(v774, v771, v772, v773, v770);
       v775.x = v771;
       v775.y = v772;
       v775.z = v773;
       v775.w = v770;
      }
     }
     v777 = v2['pixelRatio'];
     if (!v610 || v778 !== v777) {
      v778 = v777;
      v8.uniform1f(pixelRatio.location, v777);
     }
     v779 = $45.call(this, v2, v611, v610);
     v780 = v779[0];
     v782 = v779[1];
     if (!v610 || v781 !== v780 || v783 !== v782) {
      v781 = v780;
      v783 = v782;
      v8.uniform2f(paletteSize.location, v780, v782);
     }
     v784 = v611['scale'];
     v785 = v784[0];
     v787 = v784[1];
     if (!v610 || v786 !== v785 || v788 !== v787) {
      v786 = v785;
      v788 = v787;
      v8.uniform2f(scale.location, v785, v787);
     }
     v789 = v611['scaleFract'];
     v790 = v789[0];
     v792 = v789[1];
     if (!v610 || v791 !== v790 || v793 !== v792) {
      v791 = v790;
      v793 = v792;
      v8.uniform2f(scaleFract.location, v790, v792);
     }
     v794 = v611['translate'];
     v795 = v794[0];
     v797 = v794[1];
     if (!v610 || v796 !== v795 || v798 !== v797) {
      v796 = v795;
      v798 = v797;
      v8.uniform2f(translate.location, v795, v797);
     }
     v799 = v611['translateFract'];
     v800 = v799[0];
     v802 = v799[1];
     if (!v610 || v801 !== v800 || v803 !== v802) {
      v801 = v800;
      v803 = v802;
      v8.uniform2f(translateFract.location, v800, v802);
     }
     v804 = v611['opacity'];
     if (!v610 || v805 !== v804) {
      v805 = v804;
      v8.uniform1f(opacity.location, v804);
     }
     v806 = v611['elements'];
     v807 = null;
     v808 = v9(v806);
     if (v808) {
      v807 = v5.createStream(v806);
     }
     else {
      v807 = v5.getElements(v806);
     }
     if (v807) v8.bindBuffer(34963, v807.buffer.buffer);
     v809 = v611['offset'];
     v810 = v611['count'];
     if (v810) {
      if (v811 > 0) {
       if (v807) {
        v609.drawElementsInstancedANGLE(0, v810, v807.type, v809 << ((v807.type - 5121) >> 1), v811);
       }
       else {
        v609.drawArraysInstancedANGLE(0, v809, v810, v811);
       }
      }
      else if (v811 < 0) {
       if (v807) {
        v8.drawElements(0, v810, v807.type, v809 << ((v807.type - 5121) >> 1));
       }
       else {
        v8.drawArrays(0, v809, v810);
       }
      }
      v2.viewportWidth = v617;
      v2.viewportHeight = v618;
      if (v625) {
       v1.destroyStream(v626);
      }
      if (v642) {
       v1.destroyStream(v643);
      }
      if (v659) {
       v1.destroyStream(v660);
      }
      if (v676) {
       v1.destroyStream(v677);
      }
      if (v693) {
       v1.destroyStream(v694);
      }
      if (v710) {
       v1.destroyStream(v711);
      }
      if (v727) {
       v1.destroyStream(v728);
      }
      if (v744) {
       v1.destroyStream(v745);
      }
      if (v761) {
       v1.destroyStream(v762);
      }
      if (v808) {
       v5.destroyStream(v807);
      }
     }
    }
    $44.unbind();
    v3.dirty = true;
    v15.setVAO(null);
    if (v607) {
     $1.cpuTime += performance.now() - v608;
    }
   }
   , 'draw': function (a0) {
    var v47, v48, v83, v84, v85, v86, v87, v88, v89, v90, v91, v92, v93, v94, v95, v96, v97, v98, v99, v100, v101, v102, v103, v104, v105, v106, v107, v108, v109, v110, v111, v112, v113, v114, v115, v116, v117, v118, v119, v120, v121, v122, v123, v124, v125, v126, v127, v128, v129, v130, v131, v132, v133, v134, v135, v136, v137, v138, v139, v140, v141, v142, v143, v144, v145, v146, v147, v148, v149, v150, v151, v152, v153, v154, v155, v156, v157, v158, v159, v160, v161, v162, v163, v164, v165, v166, v167, v168, v169, v170, v171, v172, v173, v174, v175, v176, v177, v178, v179, v180, v181, v182, v183, v184, v185, v186, v187, v188, v189, v190, v191, v192, v193, v194, v195, v196, v197, v198, v199, v200, v201, v202, v203, v204, v205, v206, v207, v208, v209, v210, v211, v212, v213, v214, v215, v216, v217, v218, v219, v220, v221, v222, v223, v224, v225, v226, v227, v228, v229, v230, v231, v232, v233, v234, v235, v236, v237, v238, v239, v240, v241, v242, v243, v244, v245, v246, v247, v248, v249, v250, v251, v252, v253, v254, v255, v256, v257, v258, v259, v260, v261, v262, v263, v264, v265, v266, v267, v268, v269, v270, v271, v272, v273;
    v47 = v6.angle_instanced_arrays;
    v48 = v7.next;
    if (v48 !== v7.cur) {
     if (v48) {
      v8.bindFramebuffer(36160, v48.framebuffer);
     }
     else {
      v8.bindFramebuffer(36160, null);
     }
     v7.cur = v48;
    }
    if (v3.dirty) {
     var v49, v50, v51, v52, v53, v54, v55, v56, v57, v58, v59, v60, v61, v62, v63, v64, v65, v66, v67, v68, v69, v70, v71, v72, v73, v74, v75, v76, v77, v78, v79, v80, v81, v82;
     v49 = v10.dither;
     if (v49 !== v3.dither) {
      if (v49) {
       v8.enable(3024);
      }
      else {
       v8.disable(3024);
      }
      v3.dither = v49;
     }
     v50 = v18[0];
     v51 = v18[1];
     if (v50 !== v19[0] || v51 !== v19[1]) {
      v8.blendEquationSeparate(v50, v51);
      v19[0] = v50;
      v19[1] = v51;
     }
     v52 = v10.depth_func;
     if (v52 !== v3.depth_func) {
      v8.depthFunc(v52);
      v3.depth_func = v52;
     }
     v53 = v24[0];
     v54 = v24[1];
     if (v53 !== v25[0] || v54 !== v25[1]) {
      v8.depthRange(v53, v54);
      v25[0] = v53;
      v25[1] = v54;
     }
     v55 = v10.depth_mask;
     if (v55 !== v3.depth_mask) {
      v8.depthMask(v55);
      v3.depth_mask = v55;
     }
     v56 = v22[0];
     v57 = v22[1];
     v58 = v22[2];
     v59 = v22[3];
     if (v56 !== v23[0] || v57 !== v23[1] || v58 !== v23[2] || v59 !== v23[3]) {
      v8.colorMask(v56, v57, v58, v59);
      v23[0] = v56;
      v23[1] = v57;
      v23[2] = v58;
      v23[3] = v59;
     }
     v60 = v10.cull_enable;
     if (v60 !== v3.cull_enable) {
      if (v60) {
       v8.enable(2884);
      }
      else {
       v8.disable(2884);
      }
      v3.cull_enable = v60;
     }
     v61 = v10.cull_face;
     if (v61 !== v3.cull_face) {
      v8.cullFace(v61);
      v3.cull_face = v61;
     }
     v62 = v10.frontFace;
     if (v62 !== v3.frontFace) {
      v8.frontFace(v62);
      v3.frontFace = v62;
     }
     v63 = v10.lineWidth;
     if (v63 !== v3.lineWidth) {
      v8.lineWidth(v63);
      v3.lineWidth = v63;
     }
     v64 = v10.polygonOffset_enable;
     if (v64 !== v3.polygonOffset_enable) {
      if (v64) {
       v8.enable(32823);
      }
      else {
       v8.disable(32823);
      }
      v3.polygonOffset_enable = v64;
     }
     v65 = v26[0];
     v66 = v26[1];
     if (v65 !== v27[0] || v66 !== v27[1]) {
      v8.polygonOffset(v65, v66);
      v27[0] = v65;
      v27[1] = v66;
     }
     v67 = v10.sample_alpha;
     if (v67 !== v3.sample_alpha) {
      if (v67) {
       v8.enable(32926);
      }
      else {
       v8.disable(32926);
      }
      v3.sample_alpha = v67;
     }
     v68 = v10.sample_enable;
     if (v68 !== v3.sample_enable) {
      if (v68) {
       v8.enable(32928);
      }
      else {
       v8.disable(32928);
      }
      v3.sample_enable = v68;
     }
     v69 = v28[0];
     v70 = v28[1];
     if (v69 !== v29[0] || v70 !== v29[1]) {
      v8.sampleCoverage(v69, v70);
      v29[0] = v69;
      v29[1] = v70;
     }
     v71 = v10.stencil_mask;
     if (v71 !== v3.stencil_mask) {
      v8.stencilMask(v71);
      v3.stencil_mask = v71;
     }
     v72 = v32[0];
     v73 = v32[1];
     v74 = v32[2];
     if (v72 !== v33[0] || v73 !== v33[1] || v74 !== v33[2]) {
      v8.stencilFunc(v72, v73, v74);
      v33[0] = v72;
      v33[1] = v73;
      v33[2] = v74;
     }
     v75 = v36[0];
     v76 = v36[1];
     v77 = v36[2];
     v78 = v36[3];
     if (v75 !== v37[0] || v76 !== v37[1] || v77 !== v37[2] || v78 !== v37[3]) {
      v8.stencilOpSeparate(v75, v76, v77, v78);
      v37[0] = v75;
      v37[1] = v76;
      v37[2] = v77;
      v37[3] = v78;
     }
     v79 = v34[0];
     v80 = v34[1];
     v81 = v34[2];
     v82 = v34[3];
     if (v79 !== v35[0] || v80 !== v35[1] || v81 !== v35[2] || v82 !== v35[3]) {
      v8.stencilOpSeparate(v79, v80, v81, v82);
      v35[0] = v79;
      v35[1] = v80;
      v35[2] = v81;
      v35[3] = v82;
     }
    }
    v83 = a0['viewport'];
    v84 = v83.x | 0;
    v85 = v83.y | 0;
    v86 = 'width' in v83 ? v83.width | 0 : (v2.framebufferWidth - v84);
    v87 = 'height' in v83 ? v83.height | 0 : (v2.framebufferHeight - v85);
    v88 = v2.viewportWidth;
    v2.viewportWidth = v86;
    v89 = v2.viewportHeight;
    v2.viewportHeight = v87;
    v8.viewport(v84, v85, v86, v87);
    v39[0] = v84;
    v39[1] = v85;
    v39[2] = v86;
    v39[3] = v87;
    v8.blendColor(0, 0, 0, 1);
    v17[0] = 0;
    v17[1] = 0;
    v17[2] = 0;
    v17[3] = 1;
    v8.enable(3042);
    v3.blend_enable = true;
    v8.blendFuncSeparate(770, 771, 773, 1);
    v21[0] = 770;
    v21[1] = 771;
    v21[2] = 773;
    v21[3] = 1;
    v8.disable(2929);
    v3.depth_enable = false;
    v90 = a0['viewport'];
    v91 = v90.x | 0;
    v92 = v90.y | 0;
    v93 = 'width' in v90 ? v90.width | 0 : (v2.framebufferWidth - v91);
    v94 = 'height' in v90 ? v90.height | 0 : (v2.framebufferHeight - v92);
    v8.scissor(v91, v92, v93, v94);
    v31[0] = v91;
    v31[1] = v92;
    v31[2] = v93;
    v31[3] = v94;
    v8.enable(3089);
    v3.scissor_enable = true;
    v8.disable(2960);
    v3.stencil_enable = false;
    v95 = v3.profile;
    if (v95) {
     v96 = performance.now();
     $1.count++;
    }
    v8.useProgram($2.program);
    v97 = v6.angle_instanced_arrays;
    v15.setVAO(null);
    v98 = $3.call(this, v2, a0, 0);
    v99 = false;
    v100 = null;
    v101 = 0;
    v102 = false;
    v103 = 0;
    v104 = 0;
    v105 = 1;
    v106 = 0;
    v107 = 5126;
    v108 = 0;
    v109 = 0;
    v110 = 0;
    v111 = 0;
    if (v9(v98)) {
     v99 = true;
     v100 = v1.createStream(34962, v98);
     v107 = v100.dtype;
    }
    else {
     v100 = v1.getBuffer(v98);
     if (v100) {
      v107 = v100.dtype;
     }
     else if ('constant' in v98) {
      v105 = 2;
      if (typeof v98.constant === 'number') {
       v109 = v98.constant;
       v110 = v111 = v108 = 0;
      }
      else {
       v109 = v98.constant.length > 0 ? v98.constant[0] : 0;
       v110 = v98.constant.length > 1 ? v98.constant[1] : 0;
       v111 = v98.constant.length > 2 ? v98.constant[2] : 0;
       v108 = v98.constant.length > 3 ? v98.constant[3] : 0;
      }
     }
     else {
      if (v9(v98.buffer)) {
       v100 = v1.createStream(34962, v98.buffer);
      }
      else {
       v100 = v1.getBuffer(v98.buffer);
      }
      v107 = 'type' in v98 ? v43[v98.type] : v100.dtype;
      v102 = !!v98.normalized;
      v104 = v98.size | 0;
      v103 = v98.offset | 0;
      v106 = v98.stride | 0;
      v101 = v98.divisor | 0;
     }
    }
    v112 = x.location;
    v113 = v0[v112];
    if (v105 === 1) {
     if (!v113.buffer) {
      v8.enableVertexAttribArray(v112);
     }
     v114 = v104 || 1;
     if (v113.type !== v107 || v113.size !== v114 || v113.buffer !== v100 || v113.normalized !== v102 || v113.offset !== v103 || v113.stride !== v106) {
      v8.bindBuffer(34962, v100.buffer);
      v8.vertexAttribPointer(v112, v114, v107, v102, v106, v103);
      v113.type = v107;
      v113.size = v114;
      v113.buffer = v100;
      v113.normalized = v102;
      v113.offset = v103;
      v113.stride = v106;
     }
     if (v113.divisor !== v101) {
      v97.vertexAttribDivisorANGLE(v112, v101);
      v113.divisor = v101;
     }
    }
    else {
     if (v113.buffer) {
      v8.disableVertexAttribArray(v112);
      v113.buffer = null;
     }
     if (v113.x !== v109 || v113.y !== v110 || v113.z !== v111 || v113.w !== v108) {
      v8.vertexAttrib4f(v112, v109, v110, v111, v108);
      v113.x = v109;
      v113.y = v110;
      v113.z = v111;
      v113.w = v108;
     }
    }
    v115 = $4.call(this, v2, a0, 0);
    v116 = false;
    v117 = null;
    v118 = 0;
    v119 = false;
    v120 = 0;
    v121 = 0;
    v122 = 1;
    v123 = 0;
    v124 = 5126;
    v125 = 0;
    v126 = 0;
    v127 = 0;
    v128 = 0;
    if (v9(v115)) {
     v116 = true;
     v117 = v1.createStream(34962, v115);
     v124 = v117.dtype;
    }
    else {
     v117 = v1.getBuffer(v115);
     if (v117) {
      v124 = v117.dtype;
     }
     else if ('constant' in v115) {
      v122 = 2;
      if (typeof v115.constant === 'number') {
       v126 = v115.constant;
       v127 = v128 = v125 = 0;
      }
      else {
       v126 = v115.constant.length > 0 ? v115.constant[0] : 0;
       v127 = v115.constant.length > 1 ? v115.constant[1] : 0;
       v128 = v115.constant.length > 2 ? v115.constant[2] : 0;
       v125 = v115.constant.length > 3 ? v115.constant[3] : 0;
      }
     }
     else {
      if (v9(v115.buffer)) {
       v117 = v1.createStream(34962, v115.buffer);
      }
      else {
       v117 = v1.getBuffer(v115.buffer);
      }
      v124 = 'type' in v115 ? v43[v115.type] : v117.dtype;
      v119 = !!v115.normalized;
      v121 = v115.size | 0;
      v120 = v115.offset | 0;
      v123 = v115.stride | 0;
      v118 = v115.divisor | 0;
     }
    }
    v129 = y.location;
    v130 = v0[v129];
    if (v122 === 1) {
     if (!v130.buffer) {
      v8.enableVertexAttribArray(v129);
     }
     v131 = v121 || 1;
     if (v130.type !== v124 || v130.size !== v131 || v130.buffer !== v117 || v130.normalized !== v119 || v130.offset !== v120 || v130.stride !== v123) {
      v8.bindBuffer(34962, v117.buffer);
      v8.vertexAttribPointer(v129, v131, v124, v119, v123, v120);
      v130.type = v124;
      v130.size = v131;
      v130.buffer = v117;
      v130.normalized = v119;
      v130.offset = v120;
      v130.stride = v123;
     }
     if (v130.divisor !== v118) {
      v97.vertexAttribDivisorANGLE(v129, v118);
      v130.divisor = v118;
     }
    }
    else {
     if (v130.buffer) {
      v8.disableVertexAttribArray(v129);
      v130.buffer = null;
     }
     if (v130.x !== v126 || v130.y !== v127 || v130.z !== v128 || v130.w !== v125) {
      v8.vertexAttrib4f(v129, v126, v127, v128, v125);
      v130.x = v126;
      v130.y = v127;
      v130.z = v128;
      v130.w = v125;
     }
    }
    v132 = $5.call(this, v2, a0, 0);
    v133 = false;
    v134 = null;
    v135 = 0;
    v136 = false;
    v137 = 0;
    v138 = 0;
    v139 = 1;
    v140 = 0;
    v141 = 5126;
    v142 = 0;
    v143 = 0;
    v144 = 0;
    v145 = 0;
    if (v9(v132)) {
     v133 = true;
     v134 = v1.createStream(34962, v132);
     v141 = v134.dtype;
    }
    else {
     v134 = v1.getBuffer(v132);
     if (v134) {
      v141 = v134.dtype;
     }
     else if ('constant' in v132) {
      v139 = 2;
      if (typeof v132.constant === 'number') {
       v143 = v132.constant;
       v144 = v145 = v142 = 0;
      }
      else {
       v143 = v132.constant.length > 0 ? v132.constant[0] : 0;
       v144 = v132.constant.length > 1 ? v132.constant[1] : 0;
       v145 = v132.constant.length > 2 ? v132.constant[2] : 0;
       v142 = v132.constant.length > 3 ? v132.constant[3] : 0;
      }
     }
     else {
      if (v9(v132.buffer)) {
       v134 = v1.createStream(34962, v132.buffer);
      }
      else {
       v134 = v1.getBuffer(v132.buffer);
      }
      v141 = 'type' in v132 ? v43[v132.type] : v134.dtype;
      v136 = !!v132.normalized;
      v138 = v132.size | 0;
      v137 = v132.offset | 0;
      v140 = v132.stride | 0;
      v135 = v132.divisor | 0;
     }
    }
    v146 = xFract.location;
    v147 = v0[v146];
    if (v139 === 1) {
     if (!v147.buffer) {
      v8.enableVertexAttribArray(v146);
     }
     v148 = v138 || 1;
     if (v147.type !== v141 || v147.size !== v148 || v147.buffer !== v134 || v147.normalized !== v136 || v147.offset !== v137 || v147.stride !== v140) {
      v8.bindBuffer(34962, v134.buffer);
      v8.vertexAttribPointer(v146, v148, v141, v136, v140, v137);
      v147.type = v141;
      v147.size = v148;
      v147.buffer = v134;
      v147.normalized = v136;
      v147.offset = v137;
      v147.stride = v140;
     }
     if (v147.divisor !== v135) {
      v97.vertexAttribDivisorANGLE(v146, v135);
      v147.divisor = v135;
     }
    }
    else {
     if (v147.buffer) {
      v8.disableVertexAttribArray(v146);
      v147.buffer = null;
     }
     if (v147.x !== v143 || v147.y !== v144 || v147.z !== v145 || v147.w !== v142) {
      v8.vertexAttrib4f(v146, v143, v144, v145, v142);
      v147.x = v143;
      v147.y = v144;
      v147.z = v145;
      v147.w = v142;
     }
    }
    v149 = $6.call(this, v2, a0, 0);
    v150 = false;
    v151 = null;
    v152 = 0;
    v153 = false;
    v154 = 0;
    v155 = 0;
    v156 = 1;
    v157 = 0;
    v158 = 5126;
    v159 = 0;
    v160 = 0;
    v161 = 0;
    v162 = 0;
    if (v9(v149)) {
     v150 = true;
     v151 = v1.createStream(34962, v149);
     v158 = v151.dtype;
    }
    else {
     v151 = v1.getBuffer(v149);
     if (v151) {
      v158 = v151.dtype;
     }
     else if ('constant' in v149) {
      v156 = 2;
      if (typeof v149.constant === 'number') {
       v160 = v149.constant;
       v161 = v162 = v159 = 0;
      }
      else {
       v160 = v149.constant.length > 0 ? v149.constant[0] : 0;
       v161 = v149.constant.length > 1 ? v149.constant[1] : 0;
       v162 = v149.constant.length > 2 ? v149.constant[2] : 0;
       v159 = v149.constant.length > 3 ? v149.constant[3] : 0;
      }
     }
     else {
      if (v9(v149.buffer)) {
       v151 = v1.createStream(34962, v149.buffer);
      }
      else {
       v151 = v1.getBuffer(v149.buffer);
      }
      v158 = 'type' in v149 ? v43[v149.type] : v151.dtype;
      v153 = !!v149.normalized;
      v155 = v149.size | 0;
      v154 = v149.offset | 0;
      v157 = v149.stride | 0;
      v152 = v149.divisor | 0;
     }
    }
    v163 = yFract.location;
    v164 = v0[v163];
    if (v156 === 1) {
     if (!v164.buffer) {
      v8.enableVertexAttribArray(v163);
     }
     v165 = v155 || 1;
     if (v164.type !== v158 || v164.size !== v165 || v164.buffer !== v151 || v164.normalized !== v153 || v164.offset !== v154 || v164.stride !== v157) {
      v8.bindBuffer(34962, v151.buffer);
      v8.vertexAttribPointer(v163, v165, v158, v153, v157, v154);
      v164.type = v158;
      v164.size = v165;
      v164.buffer = v151;
      v164.normalized = v153;
      v164.offset = v154;
      v164.stride = v157;
     }
     if (v164.divisor !== v152) {
      v97.vertexAttribDivisorANGLE(v163, v152);
      v164.divisor = v152;
     }
    }
    else {
     if (v164.buffer) {
      v8.disableVertexAttribArray(v163);
      v164.buffer = null;
     }
     if (v164.x !== v160 || v164.y !== v161 || v164.z !== v162 || v164.w !== v159) {
      v8.vertexAttrib4f(v163, v160, v161, v162, v159);
      v164.x = v160;
      v164.y = v161;
      v164.z = v162;
      v164.w = v159;
     }
    }
    v166 = $7.call(this, v2, a0, 0);
    v167 = false;
    v168 = null;
    v169 = 0;
    v170 = false;
    v171 = 0;
    v172 = 0;
    v173 = 1;
    v174 = 0;
    v175 = 5126;
    v176 = 0;
    v177 = 0;
    v178 = 0;
    v179 = 0;
    if (v9(v166)) {
     v167 = true;
     v168 = v1.createStream(34962, v166);
     v175 = v168.dtype;
    }
    else {
     v168 = v1.getBuffer(v166);
     if (v168) {
      v175 = v168.dtype;
     }
     else if ('constant' in v166) {
      v173 = 2;
      if (typeof v166.constant === 'number') {
       v177 = v166.constant;
       v178 = v179 = v176 = 0;
      }
      else {
       v177 = v166.constant.length > 0 ? v166.constant[0] : 0;
       v178 = v166.constant.length > 1 ? v166.constant[1] : 0;
       v179 = v166.constant.length > 2 ? v166.constant[2] : 0;
       v176 = v166.constant.length > 3 ? v166.constant[3] : 0;
      }
     }
     else {
      if (v9(v166.buffer)) {
       v168 = v1.createStream(34962, v166.buffer);
      }
      else {
       v168 = v1.getBuffer(v166.buffer);
      }
      v175 = 'type' in v166 ? v43[v166.type] : v168.dtype;
      v170 = !!v166.normalized;
      v172 = v166.size | 0;
      v171 = v166.offset | 0;
      v174 = v166.stride | 0;
      v169 = v166.divisor | 0;
     }
    }
    v180 = size.location;
    v181 = v0[v180];
    if (v173 === 1) {
     if (!v181.buffer) {
      v8.enableVertexAttribArray(v180);
     }
     v182 = v172 || 1;
     if (v181.type !== v175 || v181.size !== v182 || v181.buffer !== v168 || v181.normalized !== v170 || v181.offset !== v171 || v181.stride !== v174) {
      v8.bindBuffer(34962, v168.buffer);
      v8.vertexAttribPointer(v180, v182, v175, v170, v174, v171);
      v181.type = v175;
      v181.size = v182;
      v181.buffer = v168;
      v181.normalized = v170;
      v181.offset = v171;
      v181.stride = v174;
     }
     if (v181.divisor !== v169) {
      v97.vertexAttribDivisorANGLE(v180, v169);
      v181.divisor = v169;
     }
    }
    else {
     if (v181.buffer) {
      v8.disableVertexAttribArray(v180);
      v181.buffer = null;
     }
     if (v181.x !== v177 || v181.y !== v178 || v181.z !== v179 || v181.w !== v176) {
      v8.vertexAttrib4f(v180, v177, v178, v179, v176);
      v181.x = v177;
      v181.y = v178;
      v181.z = v179;
      v181.w = v176;
     }
    }
    v183 = $8.call(this, v2, a0, 0);
    v184 = false;
    v185 = null;
    v186 = 0;
    v187 = false;
    v188 = 0;
    v189 = 0;
    v190 = 1;
    v191 = 0;
    v192 = 5126;
    v193 = 0;
    v194 = 0;
    v195 = 0;
    v196 = 0;
    if (v9(v183)) {
     v184 = true;
     v185 = v1.createStream(34962, v183);
     v192 = v185.dtype;
    }
    else {
     v185 = v1.getBuffer(v183);
     if (v185) {
      v192 = v185.dtype;
     }
     else if ('constant' in v183) {
      v190 = 2;
      if (typeof v183.constant === 'number') {
       v194 = v183.constant;
       v195 = v196 = v193 = 0;
      }
      else {
       v194 = v183.constant.length > 0 ? v183.constant[0] : 0;
       v195 = v183.constant.length > 1 ? v183.constant[1] : 0;
       v196 = v183.constant.length > 2 ? v183.constant[2] : 0;
       v193 = v183.constant.length > 3 ? v183.constant[3] : 0;
      }
     }
     else {
      if (v9(v183.buffer)) {
       v185 = v1.createStream(34962, v183.buffer);
      }
      else {
       v185 = v1.getBuffer(v183.buffer);
      }
      v192 = 'type' in v183 ? v43[v183.type] : v185.dtype;
      v187 = !!v183.normalized;
      v189 = v183.size | 0;
      v188 = v183.offset | 0;
      v191 = v183.stride | 0;
      v186 = v183.divisor | 0;
     }
    }
    v197 = borderSize.location;
    v198 = v0[v197];
    if (v190 === 1) {
     if (!v198.buffer) {
      v8.enableVertexAttribArray(v197);
     }
     v199 = v189 || 1;
     if (v198.type !== v192 || v198.size !== v199 || v198.buffer !== v185 || v198.normalized !== v187 || v198.offset !== v188 || v198.stride !== v191) {
      v8.bindBuffer(34962, v185.buffer);
      v8.vertexAttribPointer(v197, v199, v192, v187, v191, v188);
      v198.type = v192;
      v198.size = v199;
      v198.buffer = v185;
      v198.normalized = v187;
      v198.offset = v188;
      v198.stride = v191;
     }
     if (v198.divisor !== v186) {
      v97.vertexAttribDivisorANGLE(v197, v186);
      v198.divisor = v186;
     }
    }
    else {
     if (v198.buffer) {
      v8.disableVertexAttribArray(v197);
      v198.buffer = null;
     }
     if (v198.x !== v194 || v198.y !== v195 || v198.z !== v196 || v198.w !== v193) {
      v8.vertexAttrib4f(v197, v194, v195, v196, v193);
      v198.x = v194;
      v198.y = v195;
      v198.z = v196;
      v198.w = v193;
     }
    }
    v200 = $9.call(this, v2, a0, 0);
    v201 = false;
    v202 = null;
    v203 = 0;
    v204 = false;
    v205 = 0;
    v206 = 0;
    v207 = 1;
    v208 = 0;
    v209 = 5126;
    v210 = 0;
    v211 = 0;
    v212 = 0;
    v213 = 0;
    if (v9(v200)) {
     v201 = true;
     v202 = v1.createStream(34962, v200);
     v209 = v202.dtype;
    }
    else {
     v202 = v1.getBuffer(v200);
     if (v202) {
      v209 = v202.dtype;
     }
     else if ('constant' in v200) {
      v207 = 2;
      if (typeof v200.constant === 'number') {
       v211 = v200.constant;
       v212 = v213 = v210 = 0;
      }
      else {
       v211 = v200.constant.length > 0 ? v200.constant[0] : 0;
       v212 = v200.constant.length > 1 ? v200.constant[1] : 0;
       v213 = v200.constant.length > 2 ? v200.constant[2] : 0;
       v210 = v200.constant.length > 3 ? v200.constant[3] : 0;
      }
     }
     else {
      if (v9(v200.buffer)) {
       v202 = v1.createStream(34962, v200.buffer);
      }
      else {
       v202 = v1.getBuffer(v200.buffer);
      }
      v209 = 'type' in v200 ? v43[v200.type] : v202.dtype;
      v204 = !!v200.normalized;
      v206 = v200.size | 0;
      v205 = v200.offset | 0;
      v208 = v200.stride | 0;
      v203 = v200.divisor | 0;
     }
    }
    v214 = colorId.location;
    v215 = v0[v214];
    if (v207 === 1) {
     if (!v215.buffer) {
      v8.enableVertexAttribArray(v214);
     }
     v216 = v206 || 4;
     if (v215.type !== v209 || v215.size !== v216 || v215.buffer !== v202 || v215.normalized !== v204 || v215.offset !== v205 || v215.stride !== v208) {
      v8.bindBuffer(34962, v202.buffer);
      v8.vertexAttribPointer(v214, v216, v209, v204, v208, v205);
      v215.type = v209;
      v215.size = v216;
      v215.buffer = v202;
      v215.normalized = v204;
      v215.offset = v205;
      v215.stride = v208;
     }
     if (v215.divisor !== v203) {
      v97.vertexAttribDivisorANGLE(v214, v203);
      v215.divisor = v203;
     }
    }
    else {
     if (v215.buffer) {
      v8.disableVertexAttribArray(v214);
      v215.buffer = null;
     }
     if (v215.x !== v211 || v215.y !== v212 || v215.z !== v213 || v215.w !== v210) {
      v8.vertexAttrib4f(v214, v211, v212, v213, v210);
      v215.x = v211;
      v215.y = v212;
      v215.z = v213;
      v215.w = v210;
     }
    }
    v217 = $10.call(this, v2, a0, 0);
    v218 = false;
    v219 = null;
    v220 = 0;
    v221 = false;
    v222 = 0;
    v223 = 0;
    v224 = 1;
    v225 = 0;
    v226 = 5126;
    v227 = 0;
    v228 = 0;
    v229 = 0;
    v230 = 0;
    if (v9(v217)) {
     v218 = true;
     v219 = v1.createStream(34962, v217);
     v226 = v219.dtype;
    }
    else {
     v219 = v1.getBuffer(v217);
     if (v219) {
      v226 = v219.dtype;
     }
     else if ('constant' in v217) {
      v224 = 2;
      if (typeof v217.constant === 'number') {
       v228 = v217.constant;
       v229 = v230 = v227 = 0;
      }
      else {
       v228 = v217.constant.length > 0 ? v217.constant[0] : 0;
       v229 = v217.constant.length > 1 ? v217.constant[1] : 0;
       v230 = v217.constant.length > 2 ? v217.constant[2] : 0;
       v227 = v217.constant.length > 3 ? v217.constant[3] : 0;
      }
     }
     else {
      if (v9(v217.buffer)) {
       v219 = v1.createStream(34962, v217.buffer);
      }
      else {
       v219 = v1.getBuffer(v217.buffer);
      }
      v226 = 'type' in v217 ? v43[v217.type] : v219.dtype;
      v221 = !!v217.normalized;
      v223 = v217.size | 0;
      v222 = v217.offset | 0;
      v225 = v217.stride | 0;
      v220 = v217.divisor | 0;
     }
    }
    v231 = borderColorId.location;
    v232 = v0[v231];
    if (v224 === 1) {
     if (!v232.buffer) {
      v8.enableVertexAttribArray(v231);
     }
     v233 = v223 || 4;
     if (v232.type !== v226 || v232.size !== v233 || v232.buffer !== v219 || v232.normalized !== v221 || v232.offset !== v222 || v232.stride !== v225) {
      v8.bindBuffer(34962, v219.buffer);
      v8.vertexAttribPointer(v231, v233, v226, v221, v225, v222);
      v232.type = v226;
      v232.size = v233;
      v232.buffer = v219;
      v232.normalized = v221;
      v232.offset = v222;
      v232.stride = v225;
     }
     if (v232.divisor !== v220) {
      v97.vertexAttribDivisorANGLE(v231, v220);
      v232.divisor = v220;
     }
    }
    else {
     if (v232.buffer) {
      v8.disableVertexAttribArray(v231);
      v232.buffer = null;
     }
     if (v232.x !== v228 || v232.y !== v229 || v232.z !== v230 || v232.w !== v227) {
      v8.vertexAttrib4f(v231, v228, v229, v230, v227);
      v232.x = v228;
      v232.y = v229;
      v232.z = v230;
      v232.w = v227;
     }
    }
    v234 = $11.call(this, v2, a0, 0);
    v235 = false;
    v236 = null;
    v237 = 0;
    v238 = false;
    v239 = 0;
    v240 = 0;
    v241 = 1;
    v242 = 0;
    v243 = 5126;
    v244 = 0;
    v245 = 0;
    v246 = 0;
    v247 = 0;
    if (v9(v234)) {
     v235 = true;
     v236 = v1.createStream(34962, v234);
     v243 = v236.dtype;
    }
    else {
     v236 = v1.getBuffer(v234);
     if (v236) {
      v243 = v236.dtype;
     }
     else if ('constant' in v234) {
      v241 = 2;
      if (typeof v234.constant === 'number') {
       v245 = v234.constant;
       v246 = v247 = v244 = 0;
      }
      else {
       v245 = v234.constant.length > 0 ? v234.constant[0] : 0;
       v246 = v234.constant.length > 1 ? v234.constant[1] : 0;
       v247 = v234.constant.length > 2 ? v234.constant[2] : 0;
       v244 = v234.constant.length > 3 ? v234.constant[3] : 0;
      }
     }
     else {
      if (v9(v234.buffer)) {
       v236 = v1.createStream(34962, v234.buffer);
      }
      else {
       v236 = v1.getBuffer(v234.buffer);
      }
      v243 = 'type' in v234 ? v43[v234.type] : v236.dtype;
      v238 = !!v234.normalized;
      v240 = v234.size | 0;
      v239 = v234.offset | 0;
      v242 = v234.stride | 0;
      v237 = v234.divisor | 0;
     }
    }
    v248 = isActive.location;
    v249 = v0[v248];
    if (v241 === 1) {
     if (!v249.buffer) {
      v8.enableVertexAttribArray(v248);
     }
     v250 = v240 || 1;
     if (v249.type !== v243 || v249.size !== v250 || v249.buffer !== v236 || v249.normalized !== v238 || v249.offset !== v239 || v249.stride !== v242) {
      v8.bindBuffer(34962, v236.buffer);
      v8.vertexAttribPointer(v248, v250, v243, v238, v242, v239);
      v249.type = v243;
      v249.size = v250;
      v249.buffer = v236;
      v249.normalized = v238;
      v249.offset = v239;
      v249.stride = v242;
     }
     if (v249.divisor !== v237) {
      v97.vertexAttribDivisorANGLE(v248, v237);
      v249.divisor = v237;
     }
    }
    else {
     if (v249.buffer) {
      v8.disableVertexAttribArray(v248);
      v249.buffer = null;
     }
     if (v249.x !== v245 || v249.y !== v246 || v249.z !== v247 || v249.w !== v244) {
      v8.vertexAttrib4f(v248, v245, v246, v247, v244);
      v249.x = v245;
      v249.y = v246;
      v249.z = v247;
      v249.w = v244;
     }
    }
    v8.uniform1i(constPointSize.location, false);
    v251 = v2['pixelRatio'];
    v8.uniform1f(pixelRatio.location, v251);
    v252 = $12.call(this, v2, a0, 0);
    v253 = v252[0];
    v254 = v252[1];
    v8.uniform2f(paletteSize.location, v253, v254);
    v255 = a0['scale'];
    v256 = v255[0];
    v257 = v255[1];
    v8.uniform2f(scale.location, v256, v257);
    v258 = a0['scaleFract'];
    v259 = v258[0];
    v260 = v258[1];
    v8.uniform2f(scaleFract.location, v259, v260);
    v261 = a0['translate'];
    v262 = v261[0];
    v263 = v261[1];
    v8.uniform2f(translate.location, v262, v263);
    v264 = a0['translateFract'];
    v265 = v264[0];
    v266 = v264[1];
    v8.uniform2f(translateFract.location, v265, v266);
    v267 = a0['opacity'];
    v8.uniform1f(opacity.location, v267);
    v8.uniform1i(paletteTexture.location, $13.bind());
    v268 = a0['elements'];
    v269 = null;
    v270 = v9(v268);
    if (v270) {
     v269 = v5.createStream(v268);
    }
    else {
     v269 = v5.getElements(v268);
    }
    if (v269) v8.bindBuffer(34963, v269.buffer.buffer);
    v271 = a0['offset'];
    v272 = a0['count'];
    if (v272) {
     v273 = v4.instances;
     if (v273 > 0) {
      if (v269) {
       v97.drawElementsInstancedANGLE(0, v272, v269.type, v271 << ((v269.type - 5121) >> 1), v273);
      }
      else {
       v97.drawArraysInstancedANGLE(0, v271, v272, v273);
      }
     }
     else if (v273 < 0) {
      if (v269) {
       v8.drawElements(0, v272, v269.type, v271 << ((v269.type - 5121) >> 1));
      }
      else {
       v8.drawArrays(0, v271, v272);
      }
     }
     v3.dirty = true;
     v15.setVAO(null);
     v2.viewportWidth = v88;
     v2.viewportHeight = v89;
     if (v95) {
      $1.cpuTime += performance.now() - v96;
     }
     if (v99) {
      v1.destroyStream(v100);
     }
     if (v116) {
      v1.destroyStream(v117);
     }
     if (v133) {
      v1.destroyStream(v134);
     }
     if (v150) {
      v1.destroyStream(v151);
     }
     if (v167) {
      v1.destroyStream(v168);
     }
     if (v184) {
      v1.destroyStream(v185);
     }
     if (v201) {
      v1.destroyStream(v202);
     }
     if (v218) {
      v1.destroyStream(v219);
     }
     if (v235) {
      v1.destroyStream(v236);
     }
     $13.unbind();
     if (v270) {
      v5.destroyStream(v269);
     }
    }
   }
   , 'scope': function (a0, a1, a2) {
    var v274, v275, v276, v277, v278, v279, v280, v281, v282, v283, v284, v285, v286, v287, v288, v289, v290, v291, v292, v293, v294, v295, v296, v297, v298, v299, v300, v301, v302, v303, v304, v305, v306, v307, v308, v309, v310, v311, v312, v313, v314, v315, v316, v317, v318, v319, v320, v321, v322, v323, v324, v325, v326, v327, v328, v329, v330, v331, v332, v333, v334, v335, v336, v337, v338, v339, v340, v341, v342, v343, v344, v345, v346, v347, v348, v349, v350, v351, v352, v353, v354, v355, v356, v357, v358, v359, v360, v361, v362, v363, v364, v365, v366, v367, v368, v369, v370, v371, v372, v373, v374, v375, v376, v377, v378, v379, v380, v381, v382, v383, v384, v385, v386, v387, v388, v389, v390, v391, v392, v393, v394, v395, v396, v397, v398, v399, v400, v401, v402, v403, v404, v405, v406, v407, v408, v409, v410, v411, v412, v413, v414, v415, v416, v417, v418, v419, v420, v421, v422, v423, v424, v425, v426, v427, v428, v429, v430, v431, v432, v433, v434, v435, v436, v437, v438, v439, v440, v441, v442, v443, v444, v445, v446, v447, v448, v449, v450, v451, v452, v453, v454, v455, v456, v457, v458, v459, v460, v461, v462, v463, v464, v465, v466, v467, v468, v469, v470, v471, v472, v473, v474, v475, v476, v477, v478, v479, v480, v481, v482, v483, v484, v485, v486, v487, v488, v489, v490, v491, v492, v493, v494, v495, v496, v497, v498, v499, v500, v501, v502, v503, v504, v505, v506, v507, v508, v509, v510, v511, v512, v513, v514, v515, v516, v517, v518, v519, v520, v521, v522, v523, v524, v525, v526, v527, v528, v529, v530, v531, v532, v533, v534, v535, v536, v537, v538, v539, v540, v541, v542, v543, v544, v545, v546, v547, v548, v549, v550, v551, v552, v553, v554, v555, v556, v557, v558, v559, v560, v561, v562, v563, v564, v565, v566, v567, v568, v569, v570;
    v274 = a0['viewport'];
    v275 = v274.x | 0;
    v276 = v274.y | 0;
    v277 = 'width' in v274 ? v274.width | 0 : (v2.framebufferWidth - v275);
    v278 = 'height' in v274 ? v274.height | 0 : (v2.framebufferHeight - v276);
    v279 = v2.viewportWidth;
    v2.viewportWidth = v277;
    v280 = v2.viewportHeight;
    v2.viewportHeight = v278;
    v281 = v38[0];
    v38[0] = v275;
    v282 = v38[1];
    v38[1] = v276;
    v283 = v38[2];
    v38[2] = v277;
    v284 = v38[3];
    v38[3] = v278;
    v285 = v16[0];
    v16[0] = 0;
    v286 = v16[1];
    v16[1] = 0;
    v287 = v16[2];
    v16[2] = 0;
    v288 = v16[3];
    v16[3] = 1;
    v289 = v10.blend_enable;
    v10.blend_enable = true;
    v290 = v20[0];
    v20[0] = 770;
    v291 = v20[1];
    v20[1] = 771;
    v292 = v20[2];
    v20[2] = 773;
    v293 = v20[3];
    v20[3] = 1;
    v294 = v10.depth_enable;
    v10.depth_enable = false;
    v295 = a0['viewport'];
    v296 = v295.x | 0;
    v297 = v295.y | 0;
    v298 = 'width' in v295 ? v295.width | 0 : (v2.framebufferWidth - v296);
    v299 = 'height' in v295 ? v295.height | 0 : (v2.framebufferHeight - v297);
    v300 = v30[0];
    v30[0] = v296;
    v301 = v30[1];
    v30[1] = v297;
    v302 = v30[2];
    v30[2] = v298;
    v303 = v30[3];
    v30[3] = v299;
    v304 = v10.scissor_enable;
    v10.scissor_enable = true;
    v305 = v10.stencil_enable;
    v10.stencil_enable = false;
    v306 = v3.profile;
    if (v306) {
     v307 = performance.now();
     $1.count++;
    }
    v308 = a0['elements'];
    v309 = null;
    v310 = v9(v308);
    if (v310) {
     v309 = v5.createStream(v308);
    }
    else {
     v309 = v5.getElements(v308);
    }
    v311 = v4.elements;
    v4.elements = v309;
    v312 = a0['offset'];
    v313 = v4.offset;
    v4.offset = v312;
    v314 = a0['count'];
    v315 = v4.count;
    v4.count = v314;
    v316 = v4.primitive;
    v4.primitive = 0;
    v317 = v14[45];
    v14[45] = false;
    v318 = a0['markerTexture'];
    v319 = v14[48];
    v14[48] = v318;
    v320 = a0['opacity'];
    v321 = v14[10];
    v14[10] = v320;
    v322 = $14.call(this, v2, a0, a2);
    v323 = v14[46];
    v14[46] = v322;
    v324 = v14[47];
    v14[47] = $15;
    v325 = v2['pixelRatio'];
    v326 = v14[34];
    v14[34] = v325;
    v327 = a0['scale'];
    v328 = v14[6];
    v14[6] = v327;
    v329 = a0['scaleFract'];
    v330 = v14[7];
    v14[7] = v329;
    v331 = a0['translate'];
    v332 = v14[8];
    v14[8] = v331;
    v333 = a0['translateFract'];
    v334 = v14[9];
    v14[9] = v333;
    v335 = $16.call(this, v2, a0, a2);
    v336 = false;
    v337 = null;
    v338 = 0;
    v339 = false;
    v340 = 0;
    v341 = 0;
    v342 = 1;
    v343 = 0;
    v344 = 5126;
    v345 = 0;
    v346 = 0;
    v347 = 0;
    v348 = 0;
    if (v9(v335)) {
     v336 = true;
     v337 = v1.createStream(34962, v335);
     v344 = v337.dtype;
    }
    else {
     v337 = v1.getBuffer(v335);
     if (v337) {
      v344 = v337.dtype;
     }
     else if ('constant' in v335) {
      v342 = 2;
      if (typeof v335.constant === 'number') {
       v346 = v335.constant;
       v347 = v348 = v345 = 0;
      }
      else {
       v346 = v335.constant.length > 0 ? v335.constant[0] : 0;
       v347 = v335.constant.length > 1 ? v335.constant[1] : 0;
       v348 = v335.constant.length > 2 ? v335.constant[2] : 0;
       v345 = v335.constant.length > 3 ? v335.constant[3] : 0;
      }
     }
     else {
      if (v9(v335.buffer)) {
       v337 = v1.createStream(34962, v335.buffer);
      }
      else {
       v337 = v1.getBuffer(v335.buffer);
      }
      v344 = 'type' in v335 ? v43[v335.type] : v337.dtype;
      v339 = !!v335.normalized;
      v341 = v335.size | 0;
      v340 = v335.offset | 0;
      v343 = v335.stride | 0;
      v338 = v335.divisor | 0;
     }
    }
    v349 = $17.buffer;
    $17.buffer = v337;
    v350 = $17.divisor;
    $17.divisor = v338;
    v351 = $17.normalized;
    $17.normalized = v339;
    v352 = $17.offset;
    $17.offset = v340;
    v353 = $17.size;
    $17.size = v341;
    v354 = $17.state;
    $17.state = v342;
    v355 = $17.stride;
    $17.stride = v343;
    v356 = $17.type;
    $17.type = v344;
    v357 = $17.w;
    $17.w = v345;
    v358 = $17.x;
    $17.x = v346;
    v359 = $17.y;
    $17.y = v347;
    v360 = $17.z;
    $17.z = v348;
    v361 = $18.call(this, v2, a0, a2);
    v362 = false;
    v363 = null;
    v364 = 0;
    v365 = false;
    v366 = 0;
    v367 = 0;
    v368 = 1;
    v369 = 0;
    v370 = 5126;
    v371 = 0;
    v372 = 0;
    v373 = 0;
    v374 = 0;
    if (v9(v361)) {
     v362 = true;
     v363 = v1.createStream(34962, v361);
     v370 = v363.dtype;
    }
    else {
     v363 = v1.getBuffer(v361);
     if (v363) {
      v370 = v363.dtype;
     }
     else if ('constant' in v361) {
      v368 = 2;
      if (typeof v361.constant === 'number') {
       v372 = v361.constant;
       v373 = v374 = v371 = 0;
      }
      else {
       v372 = v361.constant.length > 0 ? v361.constant[0] : 0;
       v373 = v361.constant.length > 1 ? v361.constant[1] : 0;
       v374 = v361.constant.length > 2 ? v361.constant[2] : 0;
       v371 = v361.constant.length > 3 ? v361.constant[3] : 0;
      }
     }
     else {
      if (v9(v361.buffer)) {
       v363 = v1.createStream(34962, v361.buffer);
      }
      else {
       v363 = v1.getBuffer(v361.buffer);
      }
      v370 = 'type' in v361 ? v43[v361.type] : v363.dtype;
      v365 = !!v361.normalized;
      v367 = v361.size | 0;
      v366 = v361.offset | 0;
      v369 = v361.stride | 0;
      v364 = v361.divisor | 0;
     }
    }
    v375 = $19.buffer;
    $19.buffer = v363;
    v376 = $19.divisor;
    $19.divisor = v364;
    v377 = $19.normalized;
    $19.normalized = v365;
    v378 = $19.offset;
    $19.offset = v366;
    v379 = $19.size;
    $19.size = v367;
    v380 = $19.state;
    $19.state = v368;
    v381 = $19.stride;
    $19.stride = v369;
    v382 = $19.type;
    $19.type = v370;
    v383 = $19.w;
    $19.w = v371;
    v384 = $19.x;
    $19.x = v372;
    v385 = $19.y;
    $19.y = v373;
    v386 = $19.z;
    $19.z = v374;
    v387 = $20.call(this, v2, a0, a2);
    v388 = false;
    v389 = null;
    v390 = 0;
    v391 = false;
    v392 = 0;
    v393 = 0;
    v394 = 1;
    v395 = 0;
    v396 = 5126;
    v397 = 0;
    v398 = 0;
    v399 = 0;
    v400 = 0;
    if (v9(v387)) {
     v388 = true;
     v389 = v1.createStream(34962, v387);
     v396 = v389.dtype;
    }
    else {
     v389 = v1.getBuffer(v387);
     if (v389) {
      v396 = v389.dtype;
     }
     else if ('constant' in v387) {
      v394 = 2;
      if (typeof v387.constant === 'number') {
       v398 = v387.constant;
       v399 = v400 = v397 = 0;
      }
      else {
       v398 = v387.constant.length > 0 ? v387.constant[0] : 0;
       v399 = v387.constant.length > 1 ? v387.constant[1] : 0;
       v400 = v387.constant.length > 2 ? v387.constant[2] : 0;
       v397 = v387.constant.length > 3 ? v387.constant[3] : 0;
      }
     }
     else {
      if (v9(v387.buffer)) {
       v389 = v1.createStream(34962, v387.buffer);
      }
      else {
       v389 = v1.getBuffer(v387.buffer);
      }
      v396 = 'type' in v387 ? v43[v387.type] : v389.dtype;
      v391 = !!v387.normalized;
      v393 = v387.size | 0;
      v392 = v387.offset | 0;
      v395 = v387.stride | 0;
      v390 = v387.divisor | 0;
     }
    }
    v401 = $21.buffer;
    $21.buffer = v389;
    v402 = $21.divisor;
    $21.divisor = v390;
    v403 = $21.normalized;
    $21.normalized = v391;
    v404 = $21.offset;
    $21.offset = v392;
    v405 = $21.size;
    $21.size = v393;
    v406 = $21.state;
    $21.state = v394;
    v407 = $21.stride;
    $21.stride = v395;
    v408 = $21.type;
    $21.type = v396;
    v409 = $21.w;
    $21.w = v397;
    v410 = $21.x;
    $21.x = v398;
    v411 = $21.y;
    $21.y = v399;
    v412 = $21.z;
    $21.z = v400;
    v413 = $22.call(this, v2, a0, a2);
    v414 = false;
    v415 = null;
    v416 = 0;
    v417 = false;
    v418 = 0;
    v419 = 0;
    v420 = 1;
    v421 = 0;
    v422 = 5126;
    v423 = 0;
    v424 = 0;
    v425 = 0;
    v426 = 0;
    if (v9(v413)) {
     v414 = true;
     v415 = v1.createStream(34962, v413);
     v422 = v415.dtype;
    }
    else {
     v415 = v1.getBuffer(v413);
     if (v415) {
      v422 = v415.dtype;
     }
     else if ('constant' in v413) {
      v420 = 2;
      if (typeof v413.constant === 'number') {
       v424 = v413.constant;
       v425 = v426 = v423 = 0;
      }
      else {
       v424 = v413.constant.length > 0 ? v413.constant[0] : 0;
       v425 = v413.constant.length > 1 ? v413.constant[1] : 0;
       v426 = v413.constant.length > 2 ? v413.constant[2] : 0;
       v423 = v413.constant.length > 3 ? v413.constant[3] : 0;
      }
     }
     else {
      if (v9(v413.buffer)) {
       v415 = v1.createStream(34962, v413.buffer);
      }
      else {
       v415 = v1.getBuffer(v413.buffer);
      }
      v422 = 'type' in v413 ? v43[v413.type] : v415.dtype;
      v417 = !!v413.normalized;
      v419 = v413.size | 0;
      v418 = v413.offset | 0;
      v421 = v413.stride | 0;
      v416 = v413.divisor | 0;
     }
    }
    v427 = $23.buffer;
    $23.buffer = v415;
    v428 = $23.divisor;
    $23.divisor = v416;
    v429 = $23.normalized;
    $23.normalized = v417;
    v430 = $23.offset;
    $23.offset = v418;
    v431 = $23.size;
    $23.size = v419;
    v432 = $23.state;
    $23.state = v420;
    v433 = $23.stride;
    $23.stride = v421;
    v434 = $23.type;
    $23.type = v422;
    v435 = $23.w;
    $23.w = v423;
    v436 = $23.x;
    $23.x = v424;
    v437 = $23.y;
    $23.y = v425;
    v438 = $23.z;
    $23.z = v426;
    v439 = $24.call(this, v2, a0, a2);
    v440 = false;
    v441 = null;
    v442 = 0;
    v443 = false;
    v444 = 0;
    v445 = 0;
    v446 = 1;
    v447 = 0;
    v448 = 5126;
    v449 = 0;
    v450 = 0;
    v451 = 0;
    v452 = 0;
    if (v9(v439)) {
     v440 = true;
     v441 = v1.createStream(34962, v439);
     v448 = v441.dtype;
    }
    else {
     v441 = v1.getBuffer(v439);
     if (v441) {
      v448 = v441.dtype;
     }
     else if ('constant' in v439) {
      v446 = 2;
      if (typeof v439.constant === 'number') {
       v450 = v439.constant;
       v451 = v452 = v449 = 0;
      }
      else {
       v450 = v439.constant.length > 0 ? v439.constant[0] : 0;
       v451 = v439.constant.length > 1 ? v439.constant[1] : 0;
       v452 = v439.constant.length > 2 ? v439.constant[2] : 0;
       v449 = v439.constant.length > 3 ? v439.constant[3] : 0;
      }
     }
     else {
      if (v9(v439.buffer)) {
       v441 = v1.createStream(34962, v439.buffer);
      }
      else {
       v441 = v1.getBuffer(v439.buffer);
      }
      v448 = 'type' in v439 ? v43[v439.type] : v441.dtype;
      v443 = !!v439.normalized;
      v445 = v439.size | 0;
      v444 = v439.offset | 0;
      v447 = v439.stride | 0;
      v442 = v439.divisor | 0;
     }
    }
    v453 = $25.buffer;
    $25.buffer = v441;
    v454 = $25.divisor;
    $25.divisor = v442;
    v455 = $25.normalized;
    $25.normalized = v443;
    v456 = $25.offset;
    $25.offset = v444;
    v457 = $25.size;
    $25.size = v445;
    v458 = $25.state;
    $25.state = v446;
    v459 = $25.stride;
    $25.stride = v447;
    v460 = $25.type;
    $25.type = v448;
    v461 = $25.w;
    $25.w = v449;
    v462 = $25.x;
    $25.x = v450;
    v463 = $25.y;
    $25.y = v451;
    v464 = $25.z;
    $25.z = v452;
    v465 = $26.call(this, v2, a0, a2);
    v466 = false;
    v467 = null;
    v468 = 0;
    v469 = false;
    v470 = 0;
    v471 = 0;
    v472 = 1;
    v473 = 0;
    v474 = 5126;
    v475 = 0;
    v476 = 0;
    v477 = 0;
    v478 = 0;
    if (v9(v465)) {
     v466 = true;
     v467 = v1.createStream(34962, v465);
     v474 = v467.dtype;
    }
    else {
     v467 = v1.getBuffer(v465);
     if (v467) {
      v474 = v467.dtype;
     }
     else if ('constant' in v465) {
      v472 = 2;
      if (typeof v465.constant === 'number') {
       v476 = v465.constant;
       v477 = v478 = v475 = 0;
      }
      else {
       v476 = v465.constant.length > 0 ? v465.constant[0] : 0;
       v477 = v465.constant.length > 1 ? v465.constant[1] : 0;
       v478 = v465.constant.length > 2 ? v465.constant[2] : 0;
       v475 = v465.constant.length > 3 ? v465.constant[3] : 0;
      }
     }
     else {
      if (v9(v465.buffer)) {
       v467 = v1.createStream(34962, v465.buffer);
      }
      else {
       v467 = v1.getBuffer(v465.buffer);
      }
      v474 = 'type' in v465 ? v43[v465.type] : v467.dtype;
      v469 = !!v465.normalized;
      v471 = v465.size | 0;
      v470 = v465.offset | 0;
      v473 = v465.stride | 0;
      v468 = v465.divisor | 0;
     }
    }
    v479 = $27.buffer;
    $27.buffer = v467;
    v480 = $27.divisor;
    $27.divisor = v468;
    v481 = $27.normalized;
    $27.normalized = v469;
    v482 = $27.offset;
    $27.offset = v470;
    v483 = $27.size;
    $27.size = v471;
    v484 = $27.state;
    $27.state = v472;
    v485 = $27.stride;
    $27.stride = v473;
    v486 = $27.type;
    $27.type = v474;
    v487 = $27.w;
    $27.w = v475;
    v488 = $27.x;
    $27.x = v476;
    v489 = $27.y;
    $27.y = v477;
    v490 = $27.z;
    $27.z = v478;
    v491 = $28.call(this, v2, a0, a2);
    v492 = false;
    v493 = null;
    v494 = 0;
    v495 = false;
    v496 = 0;
    v497 = 0;
    v498 = 1;
    v499 = 0;
    v500 = 5126;
    v501 = 0;
    v502 = 0;
    v503 = 0;
    v504 = 0;
    if (v9(v491)) {
     v492 = true;
     v493 = v1.createStream(34962, v491);
     v500 = v493.dtype;
    }
    else {
     v493 = v1.getBuffer(v491);
     if (v493) {
      v500 = v493.dtype;
     }
     else if ('constant' in v491) {
      v498 = 2;
      if (typeof v491.constant === 'number') {
       v502 = v491.constant;
       v503 = v504 = v501 = 0;
      }
      else {
       v502 = v491.constant.length > 0 ? v491.constant[0] : 0;
       v503 = v491.constant.length > 1 ? v491.constant[1] : 0;
       v504 = v491.constant.length > 2 ? v491.constant[2] : 0;
       v501 = v491.constant.length > 3 ? v491.constant[3] : 0;
      }
     }
     else {
      if (v9(v491.buffer)) {
       v493 = v1.createStream(34962, v491.buffer);
      }
      else {
       v493 = v1.getBuffer(v491.buffer);
      }
      v500 = 'type' in v491 ? v43[v491.type] : v493.dtype;
      v495 = !!v491.normalized;
      v497 = v491.size | 0;
      v496 = v491.offset | 0;
      v499 = v491.stride | 0;
      v494 = v491.divisor | 0;
     }
    }
    v505 = $29.buffer;
    $29.buffer = v493;
    v506 = $29.divisor;
    $29.divisor = v494;
    v507 = $29.normalized;
    $29.normalized = v495;
    v508 = $29.offset;
    $29.offset = v496;
    v509 = $29.size;
    $29.size = v497;
    v510 = $29.state;
    $29.state = v498;
    v511 = $29.stride;
    $29.stride = v499;
    v512 = $29.type;
    $29.type = v500;
    v513 = $29.w;
    $29.w = v501;
    v514 = $29.x;
    $29.x = v502;
    v515 = $29.y;
    $29.y = v503;
    v516 = $29.z;
    $29.z = v504;
    v517 = $30.call(this, v2, a0, a2);
    v518 = false;
    v519 = null;
    v520 = 0;
    v521 = false;
    v522 = 0;
    v523 = 0;
    v524 = 1;
    v525 = 0;
    v526 = 5126;
    v527 = 0;
    v528 = 0;
    v529 = 0;
    v530 = 0;
    if (v9(v517)) {
     v518 = true;
     v519 = v1.createStream(34962, v517);
     v526 = v519.dtype;
    }
    else {
     v519 = v1.getBuffer(v517);
     if (v519) {
      v526 = v519.dtype;
     }
     else if ('constant' in v517) {
      v524 = 2;
      if (typeof v517.constant === 'number') {
       v528 = v517.constant;
       v529 = v530 = v527 = 0;
      }
      else {
       v528 = v517.constant.length > 0 ? v517.constant[0] : 0;
       v529 = v517.constant.length > 1 ? v517.constant[1] : 0;
       v530 = v517.constant.length > 2 ? v517.constant[2] : 0;
       v527 = v517.constant.length > 3 ? v517.constant[3] : 0;
      }
     }
     else {
      if (v9(v517.buffer)) {
       v519 = v1.createStream(34962, v517.buffer);
      }
      else {
       v519 = v1.getBuffer(v517.buffer);
      }
      v526 = 'type' in v517 ? v43[v517.type] : v519.dtype;
      v521 = !!v517.normalized;
      v523 = v517.size | 0;
      v522 = v517.offset | 0;
      v525 = v517.stride | 0;
      v520 = v517.divisor | 0;
     }
    }
    v531 = $31.buffer;
    $31.buffer = v519;
    v532 = $31.divisor;
    $31.divisor = v520;
    v533 = $31.normalized;
    $31.normalized = v521;
    v534 = $31.offset;
    $31.offset = v522;
    v535 = $31.size;
    $31.size = v523;
    v536 = $31.state;
    $31.state = v524;
    v537 = $31.stride;
    $31.stride = v525;
    v538 = $31.type;
    $31.type = v526;
    v539 = $31.w;
    $31.w = v527;
    v540 = $31.x;
    $31.x = v528;
    v541 = $31.y;
    $31.y = v529;
    v542 = $31.z;
    $31.z = v530;
    v543 = $32.call(this, v2, a0, a2);
    v544 = false;
    v545 = null;
    v546 = 0;
    v547 = false;
    v548 = 0;
    v549 = 0;
    v550 = 1;
    v551 = 0;
    v552 = 5126;
    v553 = 0;
    v554 = 0;
    v555 = 0;
    v556 = 0;
    if (v9(v543)) {
     v544 = true;
     v545 = v1.createStream(34962, v543);
     v552 = v545.dtype;
    }
    else {
     v545 = v1.getBuffer(v543);
     if (v545) {
      v552 = v545.dtype;
     }
     else if ('constant' in v543) {
      v550 = 2;
      if (typeof v543.constant === 'number') {
       v554 = v543.constant;
       v555 = v556 = v553 = 0;
      }
      else {
       v554 = v543.constant.length > 0 ? v543.constant[0] : 0;
       v555 = v543.constant.length > 1 ? v543.constant[1] : 0;
       v556 = v543.constant.length > 2 ? v543.constant[2] : 0;
       v553 = v543.constant.length > 3 ? v543.constant[3] : 0;
      }
     }
     else {
      if (v9(v543.buffer)) {
       v545 = v1.createStream(34962, v543.buffer);
      }
      else {
       v545 = v1.getBuffer(v543.buffer);
      }
      v552 = 'type' in v543 ? v43[v543.type] : v545.dtype;
      v547 = !!v543.normalized;
      v549 = v543.size | 0;
      v548 = v543.offset | 0;
      v551 = v543.stride | 0;
      v546 = v543.divisor | 0;
     }
    }
    v557 = $33.buffer;
    $33.buffer = v545;
    v558 = $33.divisor;
    $33.divisor = v546;
    v559 = $33.normalized;
    $33.normalized = v547;
    v560 = $33.offset;
    $33.offset = v548;
    v561 = $33.size;
    $33.size = v549;
    v562 = $33.state;
    $33.state = v550;
    v563 = $33.stride;
    $33.stride = v551;
    v564 = $33.type;
    $33.type = v552;
    v565 = $33.w;
    $33.w = v553;
    v566 = $33.x;
    $33.x = v554;
    v567 = $33.y;
    $33.y = v555;
    v568 = $33.z;
    $33.z = v556;
    v569 = v11.vert;
    v11.vert = 59;
    v570 = v11.frag;
    v11.frag = 58;
    v3.dirty = true;
    a1(v2, a0, a2);
    v2.viewportWidth = v279;
    v2.viewportHeight = v280;
    v38[0] = v281;
    v38[1] = v282;
    v38[2] = v283;
    v38[3] = v284;
    v16[0] = v285;
    v16[1] = v286;
    v16[2] = v287;
    v16[3] = v288;
    v10.blend_enable = v289;
    v20[0] = v290;
    v20[1] = v291;
    v20[2] = v292;
    v20[3] = v293;
    v10.depth_enable = v294;
    v30[0] = v300;
    v30[1] = v301;
    v30[2] = v302;
    v30[3] = v303;
    v10.scissor_enable = v304;
    v10.stencil_enable = v305;
    if (v306) {
     $1.cpuTime += performance.now() - v307;
    }
    if (v310) {
     v5.destroyStream(v309);
    }
    v4.elements = v311;
    v4.offset = v313;
    v4.count = v315;
    v4.primitive = v316;
    v14[45] = v317;
    v14[48] = v319;
    v14[10] = v321;
    v14[46] = v323;
    v14[47] = v324;
    v14[34] = v326;
    v14[6] = v328;
    v14[7] = v330;
    v14[8] = v332;
    v14[9] = v334;
    if (v336) {
     v1.destroyStream(v337);
    }
    $17.buffer = v349;
    $17.divisor = v350;
    $17.normalized = v351;
    $17.offset = v352;
    $17.size = v353;
    $17.state = v354;
    $17.stride = v355;
    $17.type = v356;
    $17.w = v357;
    $17.x = v358;
    $17.y = v359;
    $17.z = v360;
    if (v362) {
     v1.destroyStream(v363);
    }
    $19.buffer = v375;
    $19.divisor = v376;
    $19.normalized = v377;
    $19.offset = v378;
    $19.size = v379;
    $19.state = v380;
    $19.stride = v381;
    $19.type = v382;
    $19.w = v383;
    $19.x = v384;
    $19.y = v385;
    $19.z = v386;
    if (v388) {
     v1.destroyStream(v389);
    }
    $21.buffer = v401;
    $21.divisor = v402;
    $21.normalized = v403;
    $21.offset = v404;
    $21.size = v405;
    $21.state = v406;
    $21.stride = v407;
    $21.type = v408;
    $21.w = v409;
    $21.x = v410;
    $21.y = v411;
    $21.z = v412;
    if (v414) {
     v1.destroyStream(v415);
    }
    $23.buffer = v427;
    $23.divisor = v428;
    $23.normalized = v429;
    $23.offset = v430;
    $23.size = v431;
    $23.state = v432;
    $23.stride = v433;
    $23.type = v434;
    $23.w = v435;
    $23.x = v436;
    $23.y = v437;
    $23.z = v438;
    if (v440) {
     v1.destroyStream(v441);
    }
    $25.buffer = v453;
    $25.divisor = v454;
    $25.normalized = v455;
    $25.offset = v456;
    $25.size = v457;
    $25.state = v458;
    $25.stride = v459;
    $25.type = v460;
    $25.w = v461;
    $25.x = v462;
    $25.y = v463;
    $25.z = v464;
    if (v466) {
     v1.destroyStream(v467);
    }
    $27.buffer = v479;
    $27.divisor = v480;
    $27.normalized = v481;
    $27.offset = v482;
    $27.size = v483;
    $27.state = v484;
    $27.stride = v485;
    $27.type = v486;
    $27.w = v487;
    $27.x = v488;
    $27.y = v489;
    $27.z = v490;
    if (v492) {
     v1.destroyStream(v493);
    }
    $29.buffer = v505;
    $29.divisor = v506;
    $29.normalized = v507;
    $29.offset = v508;
    $29.size = v509;
    $29.state = v510;
    $29.stride = v511;
    $29.type = v512;
    $29.w = v513;
    $29.x = v514;
    $29.y = v515;
    $29.z = v516;
    if (v518) {
     v1.destroyStream(v519);
    }
    $31.buffer = v531;
    $31.divisor = v532;
    $31.normalized = v533;
    $31.offset = v534;
    $31.size = v535;
    $31.state = v536;
    $31.stride = v537;
    $31.type = v538;
    $31.w = v539;
    $31.x = v540;
    $31.y = v541;
    $31.z = v542;
    if (v544) {
     v1.destroyStream(v545);
    }
    $33.buffer = v557;
    $33.divisor = v558;
    $33.normalized = v559;
    $33.offset = v560;
    $33.size = v561;
    $33.state = v562;
    $33.stride = v563;
    $33.type = v564;
    $33.w = v565;
    $33.x = v566;
    $33.y = v567;
    $33.z = v568;
    v11.vert = v569;
    v11.frag = v570;
    v3.dirty = true;
   }
   ,
  }

 },
 '$22,align,atlas,atlasDim,atlasSize,baseline,char,charOffset,charStep,color,em,opacity,position,positionOffset,scale,translate,viewport,width': function ($0, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, align, atlas, atlasDim, atlasSize, baseline, char, charOffset, charStep, color, em, opacity, position, positionOffset, scale, translate, viewport, width
 ) {
  'use strict';
  var v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15, v16, v17, v18, v19, v20, v21, v22, v23, v24, v25, v26, v27, v28, v29, v30, v31, v32, v33, v34, v35, v36, v37, v38, v39, v40, v41, v42, v43, v44, v45, v46, v47, v48;
  v0 = $0.attributes;
  v1 = $0.buffer;
  v2 = $0.context;
  v3 = $0.current;
  v4 = $0.draw;
  v5 = $0.elements;
  v6 = $0.extensions;
  v7 = $0.framebuffer;
  v8 = $0.gl;
  v9 = $0.isBufferArgs;
  v10 = $0.next;
  v11 = $0.shader;
  v12 = $0.strings;
  v13 = $0.timer;
  v14 = $0.uniforms;
  v15 = $0.vao;
  v16 = v10.blend_color;
  v17 = v3.blend_color;
  v18 = v10.blend_equation;
  v19 = v3.blend_equation;
  v20 = v10.blend_func;
  v21 = v3.blend_func;
  v22 = v10.colorMask;
  v23 = v3.colorMask;
  v24 = v10.depth_range;
  v25 = v3.depth_range;
  v26 = v10.polygonOffset_offset;
  v27 = v3.polygonOffset_offset;
  v28 = v10.sample_coverage;
  v29 = v3.sample_coverage;
  v30 = v10.scissor_box;
  v31 = v3.scissor_box;
  v32 = v10.stencil_func;
  v33 = v3.stencil_func;
  v34 = v10.stencil_opBack;
  v35 = v3.stencil_opBack;
  v36 = v10.stencil_opFront;
  v37 = v3.stencil_opFront;
  v38 = v10.viewport;
  v39 = v3.viewport;
  v40 = {
   'add': 32774, 'subtract': 32778, 'reverse subtract': 32779
  }
   ;
  v41 = {
   '0': 0, '1': 1, 'zero': 0, 'one': 1, 'src color': 768, 'one minus src color': 769, 'src alpha': 770, 'one minus src alpha': 771, 'dst color': 774, 'one minus dst color': 775, 'dst alpha': 772, 'one minus dst alpha': 773, 'constant color': 32769, 'one minus constant color': 32770, 'constant alpha': 32771, 'one minus constant alpha': 32772, 'src alpha saturate': 776
  }
   ;
  v42 = {
   'never': 512, 'less': 513, '<': 513, 'equal': 514, '=': 514, '==': 514, '===': 514, 'lequal': 515, '<=': 515, 'greater': 516, '>': 516, 'notequal': 517, '!=': 517, '!==': 517, 'gequal': 518, '>=': 518, 'always': 519
  }
   ;
  v43 = {
   'int8': 5120, 'int16': 5122, 'int32': 5124, 'uint8': 5121, 'uint16': 5123, 'uint32': 5125, 'float': 5126, 'float32': 5126
  }
   ;
  v44 = {
   'cw': 2304, 'ccw': 2305
  }
   ;
  v45 = {
   'points': 0, 'point': 0, 'lines': 1, 'line': 1, 'triangles': 4, 'triangle': 4, 'line loop': 2, 'line strip': 3, 'triangle strip': 5, 'triangle fan': 6
  }
   ;
  v46 = {
   '0': 0, 'zero': 0, 'keep': 7680, 'replace': 7681, 'increment': 7682, 'decrement': 7683, 'increment wrap': 34055, 'decrement wrap': 34056, 'invert': 5386
  }
   ;
  v47 = {
  }
   ;
  v47.offset = 4;
  v47.stride = 8;
  v48 = {
  }
   ;
  v48.offset = 0;
  v48.stride = 8;
  return {
   'batch': function (a0, a1) {
    var v365, v366, v406, v407, v408, v409, v410, v411, v412, v413, v414, v415, v416, v417;
    v365 = v6.angle_instanced_arrays;
    v366 = v7.next;
    if (v366 !== v7.cur) {
     if (v366) {
      v8.bindFramebuffer(36160, v366.framebuffer);
     }
     else {
      v8.bindFramebuffer(36160, null);
     }
     v7.cur = v366;
    }
    if (v3.dirty) {
     var v367, v368, v369, v370, v371, v372, v373, v374, v375, v376, v377, v378, v379, v380, v381, v382, v383, v384, v385, v386, v387, v388, v389, v390, v391, v392, v393, v394, v395, v396, v397, v398, v399, v400, v401, v402, v403, v404, v405;
     v367 = v10.dither;
     if (v367 !== v3.dither) {
      if (v367) {
       v8.enable(3024);
      }
      else {
       v8.disable(3024);
      }
      v3.dither = v367;
     }
     v368 = v18[0];
     v369 = v18[1];
     if (v368 !== v19[0] || v369 !== v19[1]) {
      v8.blendEquationSeparate(v368, v369);
      v19[0] = v368;
      v19[1] = v369;
     }
     v370 = v10.depth_func;
     if (v370 !== v3.depth_func) {
      v8.depthFunc(v370);
      v3.depth_func = v370;
     }
     v371 = v24[0];
     v372 = v24[1];
     if (v371 !== v25[0] || v372 !== v25[1]) {
      v8.depthRange(v371, v372);
      v25[0] = v371;
      v25[1] = v372;
     }
     v373 = v10.depth_mask;
     if (v373 !== v3.depth_mask) {
      v8.depthMask(v373);
      v3.depth_mask = v373;
     }
     v374 = v22[0];
     v375 = v22[1];
     v376 = v22[2];
     v377 = v22[3];
     if (v374 !== v23[0] || v375 !== v23[1] || v376 !== v23[2] || v377 !== v23[3]) {
      v8.colorMask(v374, v375, v376, v377);
      v23[0] = v374;
      v23[1] = v375;
      v23[2] = v376;
      v23[3] = v377;
     }
     v378 = v10.cull_enable;
     if (v378 !== v3.cull_enable) {
      if (v378) {
       v8.enable(2884);
      }
      else {
       v8.disable(2884);
      }
      v3.cull_enable = v378;
     }
     v379 = v10.cull_face;
     if (v379 !== v3.cull_face) {
      v8.cullFace(v379);
      v3.cull_face = v379;
     }
     v380 = v10.frontFace;
     if (v380 !== v3.frontFace) {
      v8.frontFace(v380);
      v3.frontFace = v380;
     }
     v381 = v10.lineWidth;
     if (v381 !== v3.lineWidth) {
      v8.lineWidth(v381);
      v3.lineWidth = v381;
     }
     v382 = v10.polygonOffset_enable;
     if (v382 !== v3.polygonOffset_enable) {
      if (v382) {
       v8.enable(32823);
      }
      else {
       v8.disable(32823);
      }
      v3.polygonOffset_enable = v382;
     }
     v383 = v26[0];
     v384 = v26[1];
     if (v383 !== v27[0] || v384 !== v27[1]) {
      v8.polygonOffset(v383, v384);
      v27[0] = v383;
      v27[1] = v384;
     }
     v385 = v10.sample_alpha;
     if (v385 !== v3.sample_alpha) {
      if (v385) {
       v8.enable(32926);
      }
      else {
       v8.disable(32926);
      }
      v3.sample_alpha = v385;
     }
     v386 = v10.sample_enable;
     if (v386 !== v3.sample_enable) {
      if (v386) {
       v8.enable(32928);
      }
      else {
       v8.disable(32928);
      }
      v3.sample_enable = v386;
     }
     v387 = v28[0];
     v388 = v28[1];
     if (v387 !== v29[0] || v388 !== v29[1]) {
      v8.sampleCoverage(v387, v388);
      v29[0] = v387;
      v29[1] = v388;
     }
     v389 = v10.stencil_mask;
     if (v389 !== v3.stencil_mask) {
      v8.stencilMask(v389);
      v3.stencil_mask = v389;
     }
     v390 = v32[0];
     v391 = v32[1];
     v392 = v32[2];
     if (v390 !== v33[0] || v391 !== v33[1] || v392 !== v33[2]) {
      v8.stencilFunc(v390, v391, v392);
      v33[0] = v390;
      v33[1] = v391;
      v33[2] = v392;
     }
     v393 = v36[0];
     v394 = v36[1];
     v395 = v36[2];
     v396 = v36[3];
     if (v393 !== v37[0] || v394 !== v37[1] || v395 !== v37[2] || v396 !== v37[3]) {
      v8.stencilOpSeparate(v393, v394, v395, v396);
      v37[0] = v393;
      v37[1] = v394;
      v37[2] = v395;
      v37[3] = v396;
     }
     v397 = v34[0];
     v398 = v34[1];
     v399 = v34[2];
     v400 = v34[3];
     if (v397 !== v35[0] || v398 !== v35[1] || v399 !== v35[2] || v400 !== v35[3]) {
      v8.stencilOpSeparate(v397, v398, v399, v400);
      v35[0] = v397;
      v35[1] = v398;
      v35[2] = v399;
      v35[3] = v400;
     }
     v401 = v10.scissor_enable;
     if (v401 !== v3.scissor_enable) {
      if (v401) {
       v8.enable(3089);
      }
      else {
       v8.disable(3089);
      }
      v3.scissor_enable = v401;
     }
     v402 = v30[0];
     v403 = v30[1];
     v404 = v30[2];
     v405 = v30[3];
     if (v402 !== v31[0] || v403 !== v31[1] || v404 !== v31[2] || v405 !== v31[3]) {
      v8.scissor(v402, v403, v404, v405);
      v31[0] = v402;
      v31[1] = v403;
      v31[2] = v404;
      v31[3] = v405;
     }
    }
    v406 = this['viewport'];
    v407 = v406.x | 0;
    v408 = v406.y | 0;
    v409 = 'width' in v406 ? v406.width | 0 : (v2.framebufferWidth - v407);
    v410 = 'height' in v406 ? v406.height | 0 : (v2.framebufferHeight - v408);
    v411 = v2.viewportWidth;
    v2.viewportWidth = v409;
    v412 = v2.viewportHeight;
    v2.viewportHeight = v410;
    v8.viewport(v407, v408, v409, v410);
    v39[0] = v407;
    v39[1] = v408;
    v39[2] = v409;
    v39[3] = v410;
    v8.blendColor(0, 0, 0, 1);
    v17[0] = 0;
    v17[1] = 0;
    v17[2] = 0;
    v17[3] = 1;
    v8.enable(3042);
    v3.blend_enable = true;
    v8.blendFuncSeparate(770, 771, 773, 1);
    v21[0] = 770;
    v21[1] = 771;
    v21[2] = 773;
    v21[3] = 1;
    v8.disable(2929);
    v3.depth_enable = false;
    v8.disable(2960);
    v3.stencil_enable = false;
    v413 = v3.profile;
    if (v413) {
     v414 = performance.now();
     $1.count += a1;
    }
    v8.useProgram($17.program);
    v415 = v6.angle_instanced_arrays;
    var v418, v419, v420, v421, v422, v423, v424, v425, v426, v427, v428, v429, v430, v431, v432, v433, v434, v435, v436, v437, v438, v439, v440, v441, v442, v443, v444, v445, v446, v447, v448, v449, v450, v451, v452, v453, v454, v455, v456, v457, v458, v459, v460, v461, v462, v463, v464, v465, v466, v467, v468, v469, v470, v471, v472, v473, v474, v475, v476, v477, v478, v479, v480, v481, v482, v483, v484, v485, v486, v487, v488, v489, v490, v491, v492, v493, v494, v495, v496, v533, v536;
    v15.setVAO(null);
    v418 = this['sizeBuffer'];
    v48.buffer = v418;
    v419 = false;
    v420 = null;
    v421 = 0;
    v422 = false;
    v423 = 0;
    v424 = 0;
    v425 = 1;
    v426 = 0;
    v427 = 5126;
    v428 = 0;
    v429 = 0;
    v430 = 0;
    v431 = 0;
    if (v9(v48)) {
     v419 = true;
     v420 = v1.createStream(34962, v48);
     v427 = v420.dtype;
    }
    else {
     v420 = v1.getBuffer(v48);
     if (v420) {
      v427 = v420.dtype;
     }
     else if ('constant' in v48) {
      v425 = 2;
      if (typeof v48.constant === 'number') {
       v429 = v48.constant;
       v430 = v431 = v428 = 0;
      }
      else {
       v429 = v48.constant.length > 0 ? v48.constant[0] : 0;
       v430 = v48.constant.length > 1 ? v48.constant[1] : 0;
       v431 = v48.constant.length > 2 ? v48.constant[2] : 0;
       v428 = v48.constant.length > 3 ? v48.constant[3] : 0;
      }
     }
     else {
      if (v9(v48.buffer)) {
       v420 = v1.createStream(34962, v48.buffer);
      }
      else {
       v420 = v1.getBuffer(v48.buffer);
      }
      v427 = 'type' in v48 ? v43[v48.type] : v420.dtype;
      v422 = !!v48.normalized;
      v424 = v48.size | 0;
      v423 = v48.offset | 0;
      v426 = v48.stride | 0;
      v421 = v48.divisor | 0;
     }
    }
    v432 = width.location;
    v433 = v0[v432];
    if (v425 === 1) {
     if (!v433.buffer) {
      v8.enableVertexAttribArray(v432);
     }
     v434 = v424 || 1;
     if (v433.type !== v427 || v433.size !== v434 || v433.buffer !== v420 || v433.normalized !== v422 || v433.offset !== v423 || v433.stride !== v426) {
      v8.bindBuffer(34962, v420.buffer);
      v8.vertexAttribPointer(v432, v434, v427, v422, v426, v423);
      v433.type = v427;
      v433.size = v434;
      v433.buffer = v420;
      v433.normalized = v422;
      v433.offset = v423;
      v433.stride = v426;
     }
     if (v433.divisor !== v421) {
      v415.vertexAttribDivisorANGLE(v432, v421);
      v433.divisor = v421;
     }
    }
    else {
     if (v433.buffer) {
      v8.disableVertexAttribArray(v432);
      v433.buffer = null;
     }
     if (v433.x !== v429 || v433.y !== v430 || v433.z !== v431 || v433.w !== v428) {
      v8.vertexAttrib4f(v432, v429, v430, v431, v428);
      v433.x = v429;
      v433.y = v430;
      v433.z = v431;
      v433.w = v428;
     }
    }
    v435 = this['sizeBuffer'];
    v47.buffer = v435;
    v436 = false;
    v437 = null;
    v438 = 0;
    v439 = false;
    v440 = 0;
    v441 = 0;
    v442 = 1;
    v443 = 0;
    v444 = 5126;
    v445 = 0;
    v446 = 0;
    v447 = 0;
    v448 = 0;
    if (v9(v47)) {
     v436 = true;
     v437 = v1.createStream(34962, v47);
     v444 = v437.dtype;
    }
    else {
     v437 = v1.getBuffer(v47);
     if (v437) {
      v444 = v437.dtype;
     }
     else if ('constant' in v47) {
      v442 = 2;
      if (typeof v47.constant === 'number') {
       v446 = v47.constant;
       v447 = v448 = v445 = 0;
      }
      else {
       v446 = v47.constant.length > 0 ? v47.constant[0] : 0;
       v447 = v47.constant.length > 1 ? v47.constant[1] : 0;
       v448 = v47.constant.length > 2 ? v47.constant[2] : 0;
       v445 = v47.constant.length > 3 ? v47.constant[3] : 0;
      }
     }
     else {
      if (v9(v47.buffer)) {
       v437 = v1.createStream(34962, v47.buffer);
      }
      else {
       v437 = v1.getBuffer(v47.buffer);
      }
      v444 = 'type' in v47 ? v43[v47.type] : v437.dtype;
      v439 = !!v47.normalized;
      v441 = v47.size | 0;
      v440 = v47.offset | 0;
      v443 = v47.stride | 0;
      v438 = v47.divisor | 0;
     }
    }
    v449 = charOffset.location;
    v450 = v0[v449];
    if (v442 === 1) {
     if (!v450.buffer) {
      v8.enableVertexAttribArray(v449);
     }
     v451 = v441 || 1;
     if (v450.type !== v444 || v450.size !== v451 || v450.buffer !== v437 || v450.normalized !== v439 || v450.offset !== v440 || v450.stride !== v443) {
      v8.bindBuffer(34962, v437.buffer);
      v8.vertexAttribPointer(v449, v451, v444, v439, v443, v440);
      v450.type = v444;
      v450.size = v451;
      v450.buffer = v437;
      v450.normalized = v439;
      v450.offset = v440;
      v450.stride = v443;
     }
     if (v450.divisor !== v438) {
      v415.vertexAttribDivisorANGLE(v449, v438);
      v450.divisor = v438;
     }
    }
    else {
     if (v450.buffer) {
      v8.disableVertexAttribArray(v449);
      v450.buffer = null;
     }
     if (v450.x !== v446 || v450.y !== v447 || v450.z !== v448 || v450.w !== v445) {
      v8.vertexAttrib4f(v449, v446, v447, v448, v445);
      v450.x = v446;
      v450.y = v447;
      v450.z = v448;
      v450.w = v445;
     }
    }
    v452 = this['charBuffer'];
    v453 = false;
    v454 = null;
    v455 = 0;
    v456 = false;
    v457 = 0;
    v458 = 0;
    v459 = 1;
    v460 = 0;
    v461 = 5126;
    v462 = 0;
    v463 = 0;
    v464 = 0;
    v465 = 0;
    if (v9(v452)) {
     v453 = true;
     v454 = v1.createStream(34962, v452);
     v461 = v454.dtype;
    }
    else {
     v454 = v1.getBuffer(v452);
     if (v454) {
      v461 = v454.dtype;
     }
     else if ('constant' in v452) {
      v459 = 2;
      if (typeof v452.constant === 'number') {
       v463 = v452.constant;
       v464 = v465 = v462 = 0;
      }
      else {
       v463 = v452.constant.length > 0 ? v452.constant[0] : 0;
       v464 = v452.constant.length > 1 ? v452.constant[1] : 0;
       v465 = v452.constant.length > 2 ? v452.constant[2] : 0;
       v462 = v452.constant.length > 3 ? v452.constant[3] : 0;
      }
     }
     else {
      if (v9(v452.buffer)) {
       v454 = v1.createStream(34962, v452.buffer);
      }
      else {
       v454 = v1.getBuffer(v452.buffer);
      }
      v461 = 'type' in v452 ? v43[v452.type] : v454.dtype;
      v456 = !!v452.normalized;
      v458 = v452.size | 0;
      v457 = v452.offset | 0;
      v460 = v452.stride | 0;
      v455 = v452.divisor | 0;
     }
    }
    v466 = char.location;
    v467 = v0[v466];
    if (v459 === 1) {
     if (!v467.buffer) {
      v8.enableVertexAttribArray(v466);
     }
     v468 = v458 || 1;
     if (v467.type !== v461 || v467.size !== v468 || v467.buffer !== v454 || v467.normalized !== v456 || v467.offset !== v457 || v467.stride !== v460) {
      v8.bindBuffer(34962, v454.buffer);
      v8.vertexAttribPointer(v466, v468, v461, v456, v460, v457);
      v467.type = v461;
      v467.size = v468;
      v467.buffer = v454;
      v467.normalized = v456;
      v467.offset = v457;
      v467.stride = v460;
     }
     if (v467.divisor !== v455) {
      v415.vertexAttribDivisorANGLE(v466, v455);
      v467.divisor = v455;
     }
    }
    else {
     if (v467.buffer) {
      v8.disableVertexAttribArray(v466);
      v467.buffer = null;
     }
     if (v467.x !== v463 || v467.y !== v464 || v467.z !== v465 || v467.w !== v462) {
      v8.vertexAttrib4f(v466, v463, v464, v465, v462);
      v467.x = v463;
      v467.y = v464;
      v467.z = v465;
      v467.w = v462;
     }
    }
    v469 = this['position'];
    v470 = false;
    v471 = null;
    v472 = 0;
    v473 = false;
    v474 = 0;
    v475 = 0;
    v476 = 1;
    v477 = 0;
    v478 = 5126;
    v479 = 0;
    v480 = 0;
    v481 = 0;
    v482 = 0;
    if (v9(v469)) {
     v470 = true;
     v471 = v1.createStream(34962, v469);
     v478 = v471.dtype;
    }
    else {
     v471 = v1.getBuffer(v469);
     if (v471) {
      v478 = v471.dtype;
     }
     else if ('constant' in v469) {
      v476 = 2;
      if (typeof v469.constant === 'number') {
       v480 = v469.constant;
       v481 = v482 = v479 = 0;
      }
      else {
       v480 = v469.constant.length > 0 ? v469.constant[0] : 0;
       v481 = v469.constant.length > 1 ? v469.constant[1] : 0;
       v482 = v469.constant.length > 2 ? v469.constant[2] : 0;
       v479 = v469.constant.length > 3 ? v469.constant[3] : 0;
      }
     }
     else {
      if (v9(v469.buffer)) {
       v471 = v1.createStream(34962, v469.buffer);
      }
      else {
       v471 = v1.getBuffer(v469.buffer);
      }
      v478 = 'type' in v469 ? v43[v469.type] : v471.dtype;
      v473 = !!v469.normalized;
      v475 = v469.size | 0;
      v474 = v469.offset | 0;
      v477 = v469.stride | 0;
      v472 = v469.divisor | 0;
     }
    }
    v483 = position.location;
    v484 = v0[v483];
    if (v476 === 1) {
     if (!v484.buffer) {
      v8.enableVertexAttribArray(v483);
     }
     v485 = v475 || 2;
     if (v484.type !== v478 || v484.size !== v485 || v484.buffer !== v471 || v484.normalized !== v473 || v484.offset !== v474 || v484.stride !== v477) {
      v8.bindBuffer(34962, v471.buffer);
      v8.vertexAttribPointer(v483, v485, v478, v473, v477, v474);
      v484.type = v478;
      v484.size = v485;
      v484.buffer = v471;
      v484.normalized = v473;
      v484.offset = v474;
      v484.stride = v477;
     }
     if (v484.divisor !== v472) {
      v415.vertexAttribDivisorANGLE(v483, v472);
      v484.divisor = v472;
     }
    }
    else {
     if (v484.buffer) {
      v8.disableVertexAttribArray(v483);
      v484.buffer = null;
     }
     if (v484.x !== v480 || v484.y !== v481 || v484.z !== v482 || v484.w !== v479) {
      v8.vertexAttrib4f(v483, v480, v481, v482, v479);
      v484.x = v480;
      v484.y = v481;
      v484.z = v482;
      v484.w = v479;
     }
    }
    v486 = this['viewportArray'];
    v487 = v486[0];
    v488 = v486[1];
    v489 = v486[2];
    v490 = v486[3];
    v8.uniform4f(viewport.location, v487, v488, v489, v490);
    v491 = this['scale'];
    v492 = v491[0];
    v493 = v491[1];
    v8.uniform2f(scale.location, v492, v493);
    v494 = this['translate'];
    v495 = v494[0];
    v496 = v494[1];
    v8.uniform2f(translate.location, v495, v496);
    v533 = v4.elements;
    if (v533) {
     v8.bindBuffer(34963, v533.buffer.buffer);
    }
    else if (v15.currentVAO) {
     v533 = v5.getElements(v15.currentVAO.elements);
     if (v533) v8.bindBuffer(34963, v533.buffer.buffer);
    }
    v536 = v4.instances;
    for (v416 = 0;
     v416 < a1;
     ++v416) {
     v417 = a0[v416];
     var v497, v498, v499, v500, v501, v502, v503, v504, v505, v506, v507, v508, v509, v510, v511, v512, v513, v514, v515, v516, v517, v518, v519, v520, v521, v522, v523, v524, v525, v526, v527, v528, v529, v530, v531, v532, v534, v535;
     v497 = $18.call(this, v2, v417, v416);
     if (!v416 || v498 !== v497) {
      v498 = v497;
      v8.uniform1f(charStep.location, v497);
     }
     v499 = $19.call(this, v2, v417, v416);
     if (!v416 || v500 !== v499) {
      v500 = v499;
      v8.uniform1f(em.location, v499);
     }
     v501 = v417['align'];
     if (!v416 || v502 !== v501) {
      v502 = v501;
      v8.uniform1f(align.location, v501);
     }
     v503 = v417['baseline'];
     if (!v416 || v504 !== v503) {
      v504 = v503;
      v8.uniform1f(baseline.location, v503);
     }
     v505 = v417['color'];
     v506 = v505[0];
     v508 = v505[1];
     v510 = v505[2];
     v512 = v505[3];
     if (!v416 || v507 !== v506 || v509 !== v508 || v511 !== v510 || v513 !== v512) {
      v507 = v506;
      v509 = v508;
      v511 = v510;
      v513 = v512;
      v8.uniform4f(color.location, v506, v508, v510, v512);
     }
     v514 = $20.call(this, v2, v417, v416);
     v515 = v514[0];
     v517 = v514[1];
     if (!v416 || v516 !== v515 || v518 !== v517) {
      v516 = v515;
      v518 = v517;
      v8.uniform2f(atlasSize.location, v515, v517);
     }
     v519 = $21.call(this, v2, v417, v416);
     v520 = v519[0];
     v522 = v519[1];
     if (!v416 || v521 !== v520 || v523 !== v522) {
      v521 = v520;
      v523 = v522;
      v8.uniform2f(atlasDim.location, v520, v522);
     }
     v524 = v417['positionOffset'];
     v525 = v524[0];
     v527 = v524[1];
     if (!v416 || v526 !== v525 || v528 !== v527) {
      v526 = v525;
      v528 = v527;
      v8.uniform2f(positionOffset.location, v525, v527);
     }
     v529 = v417['opacity'];
     if (!v416 || v530 !== v529) {
      v530 = v529;
      v8.uniform1f(opacity.location, v529);
     }
     v531 = $22.call(this, v2, v417, v416);
     if (v531 && v531._reglType === 'framebuffer') {
      v531 = v531.color[0];
     }
     v532 = v531._texture;
     v8.uniform1i(atlas.location, v532.bind());
     v534 = v417['offset'];
     v535 = v417['count'];
     if (v535) {
      if (v536 > 0) {
       if (v533) {
        v415.drawElementsInstancedANGLE(0, v535, v533.type, v534 << ((v533.type - 5121) >> 1), v536);
       }
       else {
        v415.drawArraysInstancedANGLE(0, v534, v535, v536);
       }
      }
      else if (v536 < 0) {
       if (v533) {
        v8.drawElements(0, v535, v533.type, v534 << ((v533.type - 5121) >> 1));
       }
       else {
        v8.drawArrays(0, v534, v535);
       }
      }
      v532.unbind();
     }
    }
    if (v419) {
     v1.destroyStream(v420);
    }
    if (v436) {
     v1.destroyStream(v437);
    }
    if (v453) {
     v1.destroyStream(v454);
    }
    if (v470) {
     v1.destroyStream(v471);
    }
    v3.dirty = true;
    v15.setVAO(null);
    v2.viewportWidth = v411;
    v2.viewportHeight = v412;
    if (v413) {
     $1.cpuTime += performance.now() - v414;
    }
   }
   , 'draw': function (a0) {
    var v49, v50, v90, v91, v92, v93, v94, v95, v96, v97, v98, v99, v100, v101, v102, v103, v104, v105, v106, v107, v108, v109, v110, v111, v112, v113, v114, v115, v116, v117, v118, v119, v120, v121, v122, v123, v124, v125, v126, v127, v128, v129, v130, v131, v132, v133, v134, v135, v136, v137, v138, v139, v140, v141, v142, v143, v144, v145, v146, v147, v148, v149, v150, v151, v152, v153, v154, v155, v156, v157, v158, v159, v160, v161, v162, v163, v164, v165, v166, v167, v168, v169, v170, v171, v172, v173, v174, v175, v176, v177, v178, v179, v180, v181, v182, v183, v184, v185, v186, v187, v188, v189, v190, v191, v192, v193, v194, v195, v196, v197, v198, v199, v200, v201, v202, v203;
    v49 = v6.angle_instanced_arrays;
    v50 = v7.next;
    if (v50 !== v7.cur) {
     if (v50) {
      v8.bindFramebuffer(36160, v50.framebuffer);
     }
     else {
      v8.bindFramebuffer(36160, null);
     }
     v7.cur = v50;
    }
    if (v3.dirty) {
     var v51, v52, v53, v54, v55, v56, v57, v58, v59, v60, v61, v62, v63, v64, v65, v66, v67, v68, v69, v70, v71, v72, v73, v74, v75, v76, v77, v78, v79, v80, v81, v82, v83, v84, v85, v86, v87, v88, v89;
     v51 = v10.dither;
     if (v51 !== v3.dither) {
      if (v51) {
       v8.enable(3024);
      }
      else {
       v8.disable(3024);
      }
      v3.dither = v51;
     }
     v52 = v18[0];
     v53 = v18[1];
     if (v52 !== v19[0] || v53 !== v19[1]) {
      v8.blendEquationSeparate(v52, v53);
      v19[0] = v52;
      v19[1] = v53;
     }
     v54 = v10.depth_func;
     if (v54 !== v3.depth_func) {
      v8.depthFunc(v54);
      v3.depth_func = v54;
     }
     v55 = v24[0];
     v56 = v24[1];
     if (v55 !== v25[0] || v56 !== v25[1]) {
      v8.depthRange(v55, v56);
      v25[0] = v55;
      v25[1] = v56;
     }
     v57 = v10.depth_mask;
     if (v57 !== v3.depth_mask) {
      v8.depthMask(v57);
      v3.depth_mask = v57;
     }
     v58 = v22[0];
     v59 = v22[1];
     v60 = v22[2];
     v61 = v22[3];
     if (v58 !== v23[0] || v59 !== v23[1] || v60 !== v23[2] || v61 !== v23[3]) {
      v8.colorMask(v58, v59, v60, v61);
      v23[0] = v58;
      v23[1] = v59;
      v23[2] = v60;
      v23[3] = v61;
     }
     v62 = v10.cull_enable;
     if (v62 !== v3.cull_enable) {
      if (v62) {
       v8.enable(2884);
      }
      else {
       v8.disable(2884);
      }
      v3.cull_enable = v62;
     }
     v63 = v10.cull_face;
     if (v63 !== v3.cull_face) {
      v8.cullFace(v63);
      v3.cull_face = v63;
     }
     v64 = v10.frontFace;
     if (v64 !== v3.frontFace) {
      v8.frontFace(v64);
      v3.frontFace = v64;
     }
     v65 = v10.lineWidth;
     if (v65 !== v3.lineWidth) {
      v8.lineWidth(v65);
      v3.lineWidth = v65;
     }
     v66 = v10.polygonOffset_enable;
     if (v66 !== v3.polygonOffset_enable) {
      if (v66) {
       v8.enable(32823);
      }
      else {
       v8.disable(32823);
      }
      v3.polygonOffset_enable = v66;
     }
     v67 = v26[0];
     v68 = v26[1];
     if (v67 !== v27[0] || v68 !== v27[1]) {
      v8.polygonOffset(v67, v68);
      v27[0] = v67;
      v27[1] = v68;
     }
     v69 = v10.sample_alpha;
     if (v69 !== v3.sample_alpha) {
      if (v69) {
       v8.enable(32926);
      }
      else {
       v8.disable(32926);
      }
      v3.sample_alpha = v69;
     }
     v70 = v10.sample_enable;
     if (v70 !== v3.sample_enable) {
      if (v70) {
       v8.enable(32928);
      }
      else {
       v8.disable(32928);
      }
      v3.sample_enable = v70;
     }
     v71 = v28[0];
     v72 = v28[1];
     if (v71 !== v29[0] || v72 !== v29[1]) {
      v8.sampleCoverage(v71, v72);
      v29[0] = v71;
      v29[1] = v72;
     }
     v73 = v10.stencil_mask;
     if (v73 !== v3.stencil_mask) {
      v8.stencilMask(v73);
      v3.stencil_mask = v73;
     }
     v74 = v32[0];
     v75 = v32[1];
     v76 = v32[2];
     if (v74 !== v33[0] || v75 !== v33[1] || v76 !== v33[2]) {
      v8.stencilFunc(v74, v75, v76);
      v33[0] = v74;
      v33[1] = v75;
      v33[2] = v76;
     }
     v77 = v36[0];
     v78 = v36[1];
     v79 = v36[2];
     v80 = v36[3];
     if (v77 !== v37[0] || v78 !== v37[1] || v79 !== v37[2] || v80 !== v37[3]) {
      v8.stencilOpSeparate(v77, v78, v79, v80);
      v37[0] = v77;
      v37[1] = v78;
      v37[2] = v79;
      v37[3] = v80;
     }
     v81 = v34[0];
     v82 = v34[1];
     v83 = v34[2];
     v84 = v34[3];
     if (v81 !== v35[0] || v82 !== v35[1] || v83 !== v35[2] || v84 !== v35[3]) {
      v8.stencilOpSeparate(v81, v82, v83, v84);
      v35[0] = v81;
      v35[1] = v82;
      v35[2] = v83;
      v35[3] = v84;
     }
     v85 = v10.scissor_enable;
     if (v85 !== v3.scissor_enable) {
      if (v85) {
       v8.enable(3089);
      }
      else {
       v8.disable(3089);
      }
      v3.scissor_enable = v85;
     }
     v86 = v30[0];
     v87 = v30[1];
     v88 = v30[2];
     v89 = v30[3];
     if (v86 !== v31[0] || v87 !== v31[1] || v88 !== v31[2] || v89 !== v31[3]) {
      v8.scissor(v86, v87, v88, v89);
      v31[0] = v86;
      v31[1] = v87;
      v31[2] = v88;
      v31[3] = v89;
     }
    }
    v90 = this['viewport'];
    v91 = v90.x | 0;
    v92 = v90.y | 0;
    v93 = 'width' in v90 ? v90.width | 0 : (v2.framebufferWidth - v91);
    v94 = 'height' in v90 ? v90.height | 0 : (v2.framebufferHeight - v92);
    v95 = v2.viewportWidth;
    v2.viewportWidth = v93;
    v96 = v2.viewportHeight;
    v2.viewportHeight = v94;
    v8.viewport(v91, v92, v93, v94);
    v39[0] = v91;
    v39[1] = v92;
    v39[2] = v93;
    v39[3] = v94;
    v8.blendColor(0, 0, 0, 1);
    v17[0] = 0;
    v17[1] = 0;
    v17[2] = 0;
    v17[3] = 1;
    v8.enable(3042);
    v3.blend_enable = true;
    v8.blendFuncSeparate(770, 771, 773, 1);
    v21[0] = 770;
    v21[1] = 771;
    v21[2] = 773;
    v21[3] = 1;
    v8.disable(2929);
    v3.depth_enable = false;
    v8.disable(2960);
    v3.stencil_enable = false;
    v97 = v3.profile;
    if (v97) {
     v98 = performance.now();
     $1.count++;
    }
    v8.useProgram($2.program);
    v99 = v6.angle_instanced_arrays;
    v15.setVAO(null);
    v100 = this['sizeBuffer'];
    v48.buffer = v100;
    v101 = false;
    v102 = null;
    v103 = 0;
    v104 = false;
    v105 = 0;
    v106 = 0;
    v107 = 1;
    v108 = 0;
    v109 = 5126;
    v110 = 0;
    v111 = 0;
    v112 = 0;
    v113 = 0;
    if (v9(v48)) {
     v101 = true;
     v102 = v1.createStream(34962, v48);
     v109 = v102.dtype;
    }
    else {
     v102 = v1.getBuffer(v48);
     if (v102) {
      v109 = v102.dtype;
     }
     else if ('constant' in v48) {
      v107 = 2;
      if (typeof v48.constant === 'number') {
       v111 = v48.constant;
       v112 = v113 = v110 = 0;
      }
      else {
       v111 = v48.constant.length > 0 ? v48.constant[0] : 0;
       v112 = v48.constant.length > 1 ? v48.constant[1] : 0;
       v113 = v48.constant.length > 2 ? v48.constant[2] : 0;
       v110 = v48.constant.length > 3 ? v48.constant[3] : 0;
      }
     }
     else {
      if (v9(v48.buffer)) {
       v102 = v1.createStream(34962, v48.buffer);
      }
      else {
       v102 = v1.getBuffer(v48.buffer);
      }
      v109 = 'type' in v48 ? v43[v48.type] : v102.dtype;
      v104 = !!v48.normalized;
      v106 = v48.size | 0;
      v105 = v48.offset | 0;
      v108 = v48.stride | 0;
      v103 = v48.divisor | 0;
     }
    }
    v114 = width.location;
    v115 = v0[v114];
    if (v107 === 1) {
     if (!v115.buffer) {
      v8.enableVertexAttribArray(v114);
     }
     v116 = v106 || 1;
     if (v115.type !== v109 || v115.size !== v116 || v115.buffer !== v102 || v115.normalized !== v104 || v115.offset !== v105 || v115.stride !== v108) {
      v8.bindBuffer(34962, v102.buffer);
      v8.vertexAttribPointer(v114, v116, v109, v104, v108, v105);
      v115.type = v109;
      v115.size = v116;
      v115.buffer = v102;
      v115.normalized = v104;
      v115.offset = v105;
      v115.stride = v108;
     }
     if (v115.divisor !== v103) {
      v99.vertexAttribDivisorANGLE(v114, v103);
      v115.divisor = v103;
     }
    }
    else {
     if (v115.buffer) {
      v8.disableVertexAttribArray(v114);
      v115.buffer = null;
     }
     if (v115.x !== v111 || v115.y !== v112 || v115.z !== v113 || v115.w !== v110) {
      v8.vertexAttrib4f(v114, v111, v112, v113, v110);
      v115.x = v111;
      v115.y = v112;
      v115.z = v113;
      v115.w = v110;
     }
    }
    v117 = this['sizeBuffer'];
    v47.buffer = v117;
    v118 = false;
    v119 = null;
    v120 = 0;
    v121 = false;
    v122 = 0;
    v123 = 0;
    v124 = 1;
    v125 = 0;
    v126 = 5126;
    v127 = 0;
    v128 = 0;
    v129 = 0;
    v130 = 0;
    if (v9(v47)) {
     v118 = true;
     v119 = v1.createStream(34962, v47);
     v126 = v119.dtype;
    }
    else {
     v119 = v1.getBuffer(v47);
     if (v119) {
      v126 = v119.dtype;
     }
     else if ('constant' in v47) {
      v124 = 2;
      if (typeof v47.constant === 'number') {
       v128 = v47.constant;
       v129 = v130 = v127 = 0;
      }
      else {
       v128 = v47.constant.length > 0 ? v47.constant[0] : 0;
       v129 = v47.constant.length > 1 ? v47.constant[1] : 0;
       v130 = v47.constant.length > 2 ? v47.constant[2] : 0;
       v127 = v47.constant.length > 3 ? v47.constant[3] : 0;
      }
     }
     else {
      if (v9(v47.buffer)) {
       v119 = v1.createStream(34962, v47.buffer);
      }
      else {
       v119 = v1.getBuffer(v47.buffer);
      }
      v126 = 'type' in v47 ? v43[v47.type] : v119.dtype;
      v121 = !!v47.normalized;
      v123 = v47.size | 0;
      v122 = v47.offset | 0;
      v125 = v47.stride | 0;
      v120 = v47.divisor | 0;
     }
    }
    v131 = charOffset.location;
    v132 = v0[v131];
    if (v124 === 1) {
     if (!v132.buffer) {
      v8.enableVertexAttribArray(v131);
     }
     v133 = v123 || 1;
     if (v132.type !== v126 || v132.size !== v133 || v132.buffer !== v119 || v132.normalized !== v121 || v132.offset !== v122 || v132.stride !== v125) {
      v8.bindBuffer(34962, v119.buffer);
      v8.vertexAttribPointer(v131, v133, v126, v121, v125, v122);
      v132.type = v126;
      v132.size = v133;
      v132.buffer = v119;
      v132.normalized = v121;
      v132.offset = v122;
      v132.stride = v125;
     }
     if (v132.divisor !== v120) {
      v99.vertexAttribDivisorANGLE(v131, v120);
      v132.divisor = v120;
     }
    }
    else {
     if (v132.buffer) {
      v8.disableVertexAttribArray(v131);
      v132.buffer = null;
     }
     if (v132.x !== v128 || v132.y !== v129 || v132.z !== v130 || v132.w !== v127) {
      v8.vertexAttrib4f(v131, v128, v129, v130, v127);
      v132.x = v128;
      v132.y = v129;
      v132.z = v130;
      v132.w = v127;
     }
    }
    v134 = this['charBuffer'];
    v135 = false;
    v136 = null;
    v137 = 0;
    v138 = false;
    v139 = 0;
    v140 = 0;
    v141 = 1;
    v142 = 0;
    v143 = 5126;
    v144 = 0;
    v145 = 0;
    v146 = 0;
    v147 = 0;
    if (v9(v134)) {
     v135 = true;
     v136 = v1.createStream(34962, v134);
     v143 = v136.dtype;
    }
    else {
     v136 = v1.getBuffer(v134);
     if (v136) {
      v143 = v136.dtype;
     }
     else if ('constant' in v134) {
      v141 = 2;
      if (typeof v134.constant === 'number') {
       v145 = v134.constant;
       v146 = v147 = v144 = 0;
      }
      else {
       v145 = v134.constant.length > 0 ? v134.constant[0] : 0;
       v146 = v134.constant.length > 1 ? v134.constant[1] : 0;
       v147 = v134.constant.length > 2 ? v134.constant[2] : 0;
       v144 = v134.constant.length > 3 ? v134.constant[3] : 0;
      }
     }
     else {
      if (v9(v134.buffer)) {
       v136 = v1.createStream(34962, v134.buffer);
      }
      else {
       v136 = v1.getBuffer(v134.buffer);
      }
      v143 = 'type' in v134 ? v43[v134.type] : v136.dtype;
      v138 = !!v134.normalized;
      v140 = v134.size | 0;
      v139 = v134.offset | 0;
      v142 = v134.stride | 0;
      v137 = v134.divisor | 0;
     }
    }
    v148 = char.location;
    v149 = v0[v148];
    if (v141 === 1) {
     if (!v149.buffer) {
      v8.enableVertexAttribArray(v148);
     }
     v150 = v140 || 1;
     if (v149.type !== v143 || v149.size !== v150 || v149.buffer !== v136 || v149.normalized !== v138 || v149.offset !== v139 || v149.stride !== v142) {
      v8.bindBuffer(34962, v136.buffer);
      v8.vertexAttribPointer(v148, v150, v143, v138, v142, v139);
      v149.type = v143;
      v149.size = v150;
      v149.buffer = v136;
      v149.normalized = v138;
      v149.offset = v139;
      v149.stride = v142;
     }
     if (v149.divisor !== v137) {
      v99.vertexAttribDivisorANGLE(v148, v137);
      v149.divisor = v137;
     }
    }
    else {
     if (v149.buffer) {
      v8.disableVertexAttribArray(v148);
      v149.buffer = null;
     }
     if (v149.x !== v145 || v149.y !== v146 || v149.z !== v147 || v149.w !== v144) {
      v8.vertexAttrib4f(v148, v145, v146, v147, v144);
      v149.x = v145;
      v149.y = v146;
      v149.z = v147;
      v149.w = v144;
     }
    }
    v151 = this['position'];
    v152 = false;
    v153 = null;
    v154 = 0;
    v155 = false;
    v156 = 0;
    v157 = 0;
    v158 = 1;
    v159 = 0;
    v160 = 5126;
    v161 = 0;
    v162 = 0;
    v163 = 0;
    v164 = 0;
    if (v9(v151)) {
     v152 = true;
     v153 = v1.createStream(34962, v151);
     v160 = v153.dtype;
    }
    else {
     v153 = v1.getBuffer(v151);
     if (v153) {
      v160 = v153.dtype;
     }
     else if ('constant' in v151) {
      v158 = 2;
      if (typeof v151.constant === 'number') {
       v162 = v151.constant;
       v163 = v164 = v161 = 0;
      }
      else {
       v162 = v151.constant.length > 0 ? v151.constant[0] : 0;
       v163 = v151.constant.length > 1 ? v151.constant[1] : 0;
       v164 = v151.constant.length > 2 ? v151.constant[2] : 0;
       v161 = v151.constant.length > 3 ? v151.constant[3] : 0;
      }
     }
     else {
      if (v9(v151.buffer)) {
       v153 = v1.createStream(34962, v151.buffer);
      }
      else {
       v153 = v1.getBuffer(v151.buffer);
      }
      v160 = 'type' in v151 ? v43[v151.type] : v153.dtype;
      v155 = !!v151.normalized;
      v157 = v151.size | 0;
      v156 = v151.offset | 0;
      v159 = v151.stride | 0;
      v154 = v151.divisor | 0;
     }
    }
    v165 = position.location;
    v166 = v0[v165];
    if (v158 === 1) {
     if (!v166.buffer) {
      v8.enableVertexAttribArray(v165);
     }
     v167 = v157 || 2;
     if (v166.type !== v160 || v166.size !== v167 || v166.buffer !== v153 || v166.normalized !== v155 || v166.offset !== v156 || v166.stride !== v159) {
      v8.bindBuffer(34962, v153.buffer);
      v8.vertexAttribPointer(v165, v167, v160, v155, v159, v156);
      v166.type = v160;
      v166.size = v167;
      v166.buffer = v153;
      v166.normalized = v155;
      v166.offset = v156;
      v166.stride = v159;
     }
     if (v166.divisor !== v154) {
      v99.vertexAttribDivisorANGLE(v165, v154);
      v166.divisor = v154;
     }
    }
    else {
     if (v166.buffer) {
      v8.disableVertexAttribArray(v165);
      v166.buffer = null;
     }
     if (v166.x !== v162 || v166.y !== v163 || v166.z !== v164 || v166.w !== v161) {
      v8.vertexAttrib4f(v165, v162, v163, v164, v161);
      v166.x = v162;
      v166.y = v163;
      v166.z = v164;
      v166.w = v161;
     }
    }
    v168 = $3.call(this, v2, a0, 0);
    v8.uniform1f(charStep.location, v168);
    v169 = $4.call(this, v2, a0, 0);
    v8.uniform1f(em.location, v169);
    v170 = a0['align'];
    v8.uniform1f(align.location, v170);
    v171 = a0['baseline'];
    v8.uniform1f(baseline.location, v171);
    v172 = this['viewportArray'];
    v173 = v172[0];
    v174 = v172[1];
    v175 = v172[2];
    v176 = v172[3];
    v8.uniform4f(viewport.location, v173, v174, v175, v176);
    v177 = a0['color'];
    v178 = v177[0];
    v179 = v177[1];
    v180 = v177[2];
    v181 = v177[3];
    v8.uniform4f(color.location, v178, v179, v180, v181);
    v182 = $5.call(this, v2, a0, 0);
    v183 = v182[0];
    v184 = v182[1];
    v8.uniform2f(atlasSize.location, v183, v184);
    v185 = $6.call(this, v2, a0, 0);
    v186 = v185[0];
    v187 = v185[1];
    v8.uniform2f(atlasDim.location, v186, v187);
    v188 = this['scale'];
    v189 = v188[0];
    v190 = v188[1];
    v8.uniform2f(scale.location, v189, v190);
    v191 = this['translate'];
    v192 = v191[0];
    v193 = v191[1];
    v8.uniform2f(translate.location, v192, v193);
    v194 = a0['positionOffset'];
    v195 = v194[0];
    v196 = v194[1];
    v8.uniform2f(positionOffset.location, v195, v196);
    v197 = a0['opacity'];
    v8.uniform1f(opacity.location, v197);
    v198 = $7.call(this, v2, a0, 0);
    if (v198 && v198._reglType === 'framebuffer') {
     v198 = v198.color[0];
    }
    v199 = v198._texture;
    v8.uniform1i(atlas.location, v199.bind());
    v200 = v4.elements;
    if (v200) {
     v8.bindBuffer(34963, v200.buffer.buffer);
    }
    else if (v15.currentVAO) {
     v200 = v5.getElements(v15.currentVAO.elements);
     if (v200) v8.bindBuffer(34963, v200.buffer.buffer);
    }
    v201 = a0['offset'];
    v202 = a0['count'];
    if (v202) {
     v203 = v4.instances;
     if (v203 > 0) {
      if (v200) {
       v99.drawElementsInstancedANGLE(0, v202, v200.type, v201 << ((v200.type - 5121) >> 1), v203);
      }
      else {
       v99.drawArraysInstancedANGLE(0, v201, v202, v203);
      }
     }
     else if (v203 < 0) {
      if (v200) {
       v8.drawElements(0, v202, v200.type, v201 << ((v200.type - 5121) >> 1));
      }
      else {
       v8.drawArrays(0, v201, v202);
      }
     }
     v3.dirty = true;
     v15.setVAO(null);
     v2.viewportWidth = v95;
     v2.viewportHeight = v96;
     if (v97) {
      $1.cpuTime += performance.now() - v98;
     }
     if (v101) {
      v1.destroyStream(v102);
     }
     if (v118) {
      v1.destroyStream(v119);
     }
     if (v135) {
      v1.destroyStream(v136);
     }
     if (v152) {
      v1.destroyStream(v153);
     }
     v199.unbind();
    }
   }
   , 'scope': function (a0, a1, a2) {
    var v204, v205, v206, v207, v208, v209, v210, v211, v212, v213, v214, v215, v216, v217, v218, v219, v220, v221, v222, v223, v224, v225, v226, v227, v228, v229, v230, v231, v232, v233, v234, v235, v236, v237, v238, v239, v240, v241, v242, v243, v244, v245, v246, v247, v248, v249, v250, v251, v252, v253, v254, v255, v256, v257, v258, v259, v260, v261, v262, v263, v264, v265, v266, v267, v268, v269, v270, v271, v272, v273, v274, v275, v276, v277, v278, v279, v280, v281, v282, v283, v284, v285, v286, v287, v288, v289, v290, v291, v292, v293, v294, v295, v296, v297, v298, v299, v300, v301, v302, v303, v304, v305, v306, v307, v308, v309, v310, v311, v312, v313, v314, v315, v316, v317, v318, v319, v320, v321, v322, v323, v324, v325, v326, v327, v328, v329, v330, v331, v332, v333, v334, v335, v336, v337, v338, v339, v340, v341, v342, v343, v344, v345, v346, v347, v348, v349, v350, v351, v352, v353, v354, v355, v356, v357, v358, v359, v360, v361, v362, v363, v364;
    v204 = this['viewport'];
    v205 = v204.x | 0;
    v206 = v204.y | 0;
    v207 = 'width' in v204 ? v204.width | 0 : (v2.framebufferWidth - v205);
    v208 = 'height' in v204 ? v204.height | 0 : (v2.framebufferHeight - v206);
    v209 = v2.viewportWidth;
    v2.viewportWidth = v207;
    v210 = v2.viewportHeight;
    v2.viewportHeight = v208;
    v211 = v38[0];
    v38[0] = v205;
    v212 = v38[1];
    v38[1] = v206;
    v213 = v38[2];
    v38[2] = v207;
    v214 = v38[3];
    v38[3] = v208;
    v215 = v16[0];
    v16[0] = 0;
    v216 = v16[1];
    v16[1] = 0;
    v217 = v16[2];
    v16[2] = 0;
    v218 = v16[3];
    v16[3] = 1;
    v219 = v10.blend_enable;
    v10.blend_enable = true;
    v220 = v20[0];
    v20[0] = 770;
    v221 = v20[1];
    v20[1] = 771;
    v222 = v20[2];
    v20[2] = 773;
    v223 = v20[3];
    v20[3] = 1;
    v224 = v10.depth_enable;
    v10.depth_enable = false;
    v225 = v10.stencil_enable;
    v10.stencil_enable = false;
    v226 = v3.profile;
    if (v226) {
     v227 = performance.now();
     $1.count++;
    }
    v228 = a0['offset'];
    v229 = v4.offset;
    v4.offset = v228;
    v230 = a0['count'];
    v231 = v4.count;
    v4.count = v230;
    v232 = v4.primitive;
    v4.primitive = 0;
    v233 = a0['align'];
    v234 = v14[64];
    v14[64] = v233;
    v235 = $8.call(this, v2, a0, a2);
    v236 = v14[69];
    v14[69] = v235;
    v237 = $9.call(this, v2, a0, a2);
    v238 = v14[67];
    v14[67] = v237;
    v239 = $10.call(this, v2, a0, a2);
    v240 = v14[66];
    v14[66] = v239;
    v241 = a0['baseline'];
    v242 = v14[65];
    v14[65] = v241;
    v243 = $11.call(this, v2, a0, a2);
    v244 = v14[62];
    v14[62] = v243;
    v245 = a0['color'];
    v246 = v14[14];
    v14[14] = v245;
    v247 = $12.call(this, v2, a0, a2);
    v248 = v14[63];
    v14[63] = v247;
    v249 = a0['opacity'];
    v250 = v14[10];
    v14[10] = v249;
    v251 = a0['positionOffset'];
    v252 = v14[68];
    v14[68] = v251;
    v253 = this['scale'];
    v254 = v14[6];
    v14[6] = v253;
    v255 = this['translate'];
    v256 = v14[8];
    v14[8] = v255;
    v257 = this['viewportArray'];
    v258 = v14[3];
    v14[3] = v257;
    v259 = this['charBuffer'];
    v260 = false;
    v261 = null;
    v262 = 0;
    v263 = false;
    v264 = 0;
    v265 = 0;
    v266 = 1;
    v267 = 0;
    v268 = 5126;
    v269 = 0;
    v270 = 0;
    v271 = 0;
    v272 = 0;
    if (v9(v259)) {
     v260 = true;
     v261 = v1.createStream(34962, v259);
     v268 = v261.dtype;
    }
    else {
     v261 = v1.getBuffer(v259);
     if (v261) {
      v268 = v261.dtype;
     }
     else if ('constant' in v259) {
      v266 = 2;
      if (typeof v259.constant === 'number') {
       v270 = v259.constant;
       v271 = v272 = v269 = 0;
      }
      else {
       v270 = v259.constant.length > 0 ? v259.constant[0] : 0;
       v271 = v259.constant.length > 1 ? v259.constant[1] : 0;
       v272 = v259.constant.length > 2 ? v259.constant[2] : 0;
       v269 = v259.constant.length > 3 ? v259.constant[3] : 0;
      }
     }
     else {
      if (v9(v259.buffer)) {
       v261 = v1.createStream(34962, v259.buffer);
      }
      else {
       v261 = v1.getBuffer(v259.buffer);
      }
      v268 = 'type' in v259 ? v43[v259.type] : v261.dtype;
      v263 = !!v259.normalized;
      v265 = v259.size | 0;
      v264 = v259.offset | 0;
      v267 = v259.stride | 0;
      v262 = v259.divisor | 0;
     }
    }
    v273 = $13.buffer;
    $13.buffer = v261;
    v274 = $13.divisor;
    $13.divisor = v262;
    v275 = $13.normalized;
    $13.normalized = v263;
    v276 = $13.offset;
    $13.offset = v264;
    v277 = $13.size;
    $13.size = v265;
    v278 = $13.state;
    $13.state = v266;
    v279 = $13.stride;
    $13.stride = v267;
    v280 = $13.type;
    $13.type = v268;
    v281 = $13.w;
    $13.w = v269;
    v282 = $13.x;
    $13.x = v270;
    v283 = $13.y;
    $13.y = v271;
    v284 = $13.z;
    $13.z = v272;
    v285 = this['sizeBuffer'];
    v47.buffer = v285;
    v286 = false;
    v287 = null;
    v288 = 0;
    v289 = false;
    v290 = 0;
    v291 = 0;
    v292 = 1;
    v293 = 0;
    v294 = 5126;
    v295 = 0;
    v296 = 0;
    v297 = 0;
    v298 = 0;
    if (v9(v47)) {
     v286 = true;
     v287 = v1.createStream(34962, v47);
     v294 = v287.dtype;
    }
    else {
     v287 = v1.getBuffer(v47);
     if (v287) {
      v294 = v287.dtype;
     }
     else if ('constant' in v47) {
      v292 = 2;
      if (typeof v47.constant === 'number') {
       v296 = v47.constant;
       v297 = v298 = v295 = 0;
      }
      else {
       v296 = v47.constant.length > 0 ? v47.constant[0] : 0;
       v297 = v47.constant.length > 1 ? v47.constant[1] : 0;
       v298 = v47.constant.length > 2 ? v47.constant[2] : 0;
       v295 = v47.constant.length > 3 ? v47.constant[3] : 0;
      }
     }
     else {
      if (v9(v47.buffer)) {
       v287 = v1.createStream(34962, v47.buffer);
      }
      else {
       v287 = v1.getBuffer(v47.buffer);
      }
      v294 = 'type' in v47 ? v43[v47.type] : v287.dtype;
      v289 = !!v47.normalized;
      v291 = v47.size | 0;
      v290 = v47.offset | 0;
      v293 = v47.stride | 0;
      v288 = v47.divisor | 0;
     }
    }
    v299 = $14.buffer;
    $14.buffer = v287;
    v300 = $14.divisor;
    $14.divisor = v288;
    v301 = $14.normalized;
    $14.normalized = v289;
    v302 = $14.offset;
    $14.offset = v290;
    v303 = $14.size;
    $14.size = v291;
    v304 = $14.state;
    $14.state = v292;
    v305 = $14.stride;
    $14.stride = v293;
    v306 = $14.type;
    $14.type = v294;
    v307 = $14.w;
    $14.w = v295;
    v308 = $14.x;
    $14.x = v296;
    v309 = $14.y;
    $14.y = v297;
    v310 = $14.z;
    $14.z = v298;
    v311 = this['position'];
    v312 = false;
    v313 = null;
    v314 = 0;
    v315 = false;
    v316 = 0;
    v317 = 0;
    v318 = 1;
    v319 = 0;
    v320 = 5126;
    v321 = 0;
    v322 = 0;
    v323 = 0;
    v324 = 0;
    if (v9(v311)) {
     v312 = true;
     v313 = v1.createStream(34962, v311);
     v320 = v313.dtype;
    }
    else {
     v313 = v1.getBuffer(v311);
     if (v313) {
      v320 = v313.dtype;
     }
     else if ('constant' in v311) {
      v318 = 2;
      if (typeof v311.constant === 'number') {
       v322 = v311.constant;
       v323 = v324 = v321 = 0;
      }
      else {
       v322 = v311.constant.length > 0 ? v311.constant[0] : 0;
       v323 = v311.constant.length > 1 ? v311.constant[1] : 0;
       v324 = v311.constant.length > 2 ? v311.constant[2] : 0;
       v321 = v311.constant.length > 3 ? v311.constant[3] : 0;
      }
     }
     else {
      if (v9(v311.buffer)) {
       v313 = v1.createStream(34962, v311.buffer);
      }
      else {
       v313 = v1.getBuffer(v311.buffer);
      }
      v320 = 'type' in v311 ? v43[v311.type] : v313.dtype;
      v315 = !!v311.normalized;
      v317 = v311.size | 0;
      v316 = v311.offset | 0;
      v319 = v311.stride | 0;
      v314 = v311.divisor | 0;
     }
    }
    v325 = $15.buffer;
    $15.buffer = v313;
    v326 = $15.divisor;
    $15.divisor = v314;
    v327 = $15.normalized;
    $15.normalized = v315;
    v328 = $15.offset;
    $15.offset = v316;
    v329 = $15.size;
    $15.size = v317;
    v330 = $15.state;
    $15.state = v318;
    v331 = $15.stride;
    $15.stride = v319;
    v332 = $15.type;
    $15.type = v320;
    v333 = $15.w;
    $15.w = v321;
    v334 = $15.x;
    $15.x = v322;
    v335 = $15.y;
    $15.y = v323;
    v336 = $15.z;
    $15.z = v324;
    v337 = this['sizeBuffer'];
    v48.buffer = v337;
    v338 = false;
    v339 = null;
    v340 = 0;
    v341 = false;
    v342 = 0;
    v343 = 0;
    v344 = 1;
    v345 = 0;
    v346 = 5126;
    v347 = 0;
    v348 = 0;
    v349 = 0;
    v350 = 0;
    if (v9(v48)) {
     v338 = true;
     v339 = v1.createStream(34962, v48);
     v346 = v339.dtype;
    }
    else {
     v339 = v1.getBuffer(v48);
     if (v339) {
      v346 = v339.dtype;
     }
     else if ('constant' in v48) {
      v344 = 2;
      if (typeof v48.constant === 'number') {
       v348 = v48.constant;
       v349 = v350 = v347 = 0;
      }
      else {
       v348 = v48.constant.length > 0 ? v48.constant[0] : 0;
       v349 = v48.constant.length > 1 ? v48.constant[1] : 0;
       v350 = v48.constant.length > 2 ? v48.constant[2] : 0;
       v347 = v48.constant.length > 3 ? v48.constant[3] : 0;
      }
     }
     else {
      if (v9(v48.buffer)) {
       v339 = v1.createStream(34962, v48.buffer);
      }
      else {
       v339 = v1.getBuffer(v48.buffer);
      }
      v346 = 'type' in v48 ? v43[v48.type] : v339.dtype;
      v341 = !!v48.normalized;
      v343 = v48.size | 0;
      v342 = v48.offset | 0;
      v345 = v48.stride | 0;
      v340 = v48.divisor | 0;
     }
    }
    v351 = $16.buffer;
    $16.buffer = v339;
    v352 = $16.divisor;
    $16.divisor = v340;
    v353 = $16.normalized;
    $16.normalized = v341;
    v354 = $16.offset;
    $16.offset = v342;
    v355 = $16.size;
    $16.size = v343;
    v356 = $16.state;
    $16.state = v344;
    v357 = $16.stride;
    $16.stride = v345;
    v358 = $16.type;
    $16.type = v346;
    v359 = $16.w;
    $16.w = v347;
    v360 = $16.x;
    $16.x = v348;
    v361 = $16.y;
    $16.y = v349;
    v362 = $16.z;
    $16.z = v350;
    v363 = v11.vert;
    v11.vert = 61;
    v364 = v11.frag;
    v11.frag = 60;
    v3.dirty = true;
    a1(v2, a0, a2);
    v2.viewportWidth = v209;
    v2.viewportHeight = v210;
    v38[0] = v211;
    v38[1] = v212;
    v38[2] = v213;
    v38[3] = v214;
    v16[0] = v215;
    v16[1] = v216;
    v16[2] = v217;
    v16[3] = v218;
    v10.blend_enable = v219;
    v20[0] = v220;
    v20[1] = v221;
    v20[2] = v222;
    v20[3] = v223;
    v10.depth_enable = v224;
    v10.stencil_enable = v225;
    if (v226) {
     $1.cpuTime += performance.now() - v227;
    }
    v4.offset = v229;
    v4.count = v231;
    v4.primitive = v232;
    v14[64] = v234;
    v14[69] = v236;
    v14[67] = v238;
    v14[66] = v240;
    v14[65] = v242;
    v14[62] = v244;
    v14[14] = v246;
    v14[63] = v248;
    v14[10] = v250;
    v14[68] = v252;
    v14[6] = v254;
    v14[8] = v256;
    v14[3] = v258;
    if (v260) {
     v1.destroyStream(v261);
    }
    $13.buffer = v273;
    $13.divisor = v274;
    $13.normalized = v275;
    $13.offset = v276;
    $13.size = v277;
    $13.state = v278;
    $13.stride = v279;
    $13.type = v280;
    $13.w = v281;
    $13.x = v282;
    $13.y = v283;
    $13.z = v284;
    if (v286) {
     v1.destroyStream(v287);
    }
    $14.buffer = v299;
    $14.divisor = v300;
    $14.normalized = v301;
    $14.offset = v302;
    $14.size = v303;
    $14.state = v304;
    $14.stride = v305;
    $14.type = v306;
    $14.w = v307;
    $14.x = v308;
    $14.y = v309;
    $14.z = v310;
    if (v312) {
     v1.destroyStream(v313);
    }
    $15.buffer = v325;
    $15.divisor = v326;
    $15.normalized = v327;
    $15.offset = v328;
    $15.size = v329;
    $15.state = v330;
    $15.stride = v331;
    $15.type = v332;
    $15.w = v333;
    $15.x = v334;
    $15.y = v335;
    $15.z = v336;
    if (v338) {
     v1.destroyStream(v339);
    }
    $16.buffer = v351;
    $16.divisor = v352;
    $16.normalized = v353;
    $16.offset = v354;
    $16.size = v355;
    $16.state = v356;
    $16.stride = v357;
    $16.type = v358;
    $16.w = v359;
    $16.x = v360;
    $16.y = v361;
    $16.z = v362;
    v11.vert = v363;
    v11.frag = v364;
    v3.dirty = true;
   }
   ,
  }

 }
};

function slice (x) {
  return Array.prototype.slice.call(x)
}

function join (x) {
  return slice(x).join('')
}

function createEnvironment () {
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

// "cute" names for vector components
var CUTE_COMPONENTS = 'xyzw'.split('')

var GL_UNSIGNED_BYTE$8 = 5121

var ATTRIB_STATE_POINTER = 1
var ATTRIB_STATE_CONSTANT = 2

var DYN_FUNC$1 = 0
var DYN_PROP$1 = 1
var DYN_CONTEXT$1 = 2
var DYN_STATE$1 = 3
var DYN_THUNK = 4
var DYN_CONSTANT$1 = 5
var DYN_ARRAY$1 = 6

var S_DITHER = 'dither'
var S_BLEND_ENABLE = 'blend.enable'
var S_BLEND_COLOR = 'blend.color'
var S_BLEND_EQUATION = 'blend.equation'
var S_BLEND_FUNC = 'blend.func'
var S_DEPTH_ENABLE = 'depth.enable'
var S_DEPTH_FUNC = 'depth.func'
var S_DEPTH_RANGE = 'depth.range'
var S_DEPTH_MASK = 'depth.mask'
var S_COLOR_MASK = 'colorMask'
var S_CULL_ENABLE = 'cull.enable'
var S_CULL_FACE = 'cull.face'
var S_FRONT_FACE = 'frontFace'
var S_LINE_WIDTH = 'lineWidth'
var S_POLYGON_OFFSET_ENABLE = 'polygonOffset.enable'
var S_POLYGON_OFFSET_OFFSET = 'polygonOffset.offset'
var S_SAMPLE_ALPHA = 'sample.alpha'
var S_SAMPLE_ENABLE = 'sample.enable'
var S_SAMPLE_COVERAGE = 'sample.coverage'
var S_STENCIL_ENABLE = 'stencil.enable'
var S_STENCIL_MASK = 'stencil.mask'
var S_STENCIL_FUNC = 'stencil.func'
var S_STENCIL_OPFRONT = 'stencil.opFront'
var S_STENCIL_OPBACK = 'stencil.opBack'
var S_SCISSOR_ENABLE = 'scissor.enable'
var S_SCISSOR_BOX = 'scissor.box'
var S_VIEWPORT = 'viewport'

var S_PROFILE = 'profile'

var S_FRAMEBUFFER = 'framebuffer'
var S_VERT = 'vert'
var S_FRAG = 'frag'
var S_ELEMENTS = 'elements'
var S_PRIMITIVE = 'primitive'
var S_COUNT = 'count'
var S_OFFSET = 'offset'
var S_INSTANCES = 'instances'
var S_VAO = 'vao'

var SUFFIX_WIDTH = 'Width'
var SUFFIX_HEIGHT = 'Height'

var S_FRAMEBUFFER_WIDTH = S_FRAMEBUFFER + SUFFIX_WIDTH
var S_FRAMEBUFFER_HEIGHT = S_FRAMEBUFFER + SUFFIX_HEIGHT
var S_VIEWPORT_WIDTH = S_VIEWPORT + SUFFIX_WIDTH
var S_VIEWPORT_HEIGHT = S_VIEWPORT + SUFFIX_HEIGHT
var S_DRAWINGBUFFER = 'drawingBuffer'
var S_DRAWINGBUFFER_WIDTH = S_DRAWINGBUFFER + SUFFIX_WIDTH
var S_DRAWINGBUFFER_HEIGHT = S_DRAWINGBUFFER + SUFFIX_HEIGHT

var NESTED_OPTIONS = [
  S_BLEND_FUNC,
  S_BLEND_EQUATION,
  S_STENCIL_FUNC,
  S_STENCIL_OPFRONT,
  S_STENCIL_OPBACK,
  S_SAMPLE_COVERAGE,
  S_VIEWPORT,
  S_SCISSOR_BOX,
  S_POLYGON_OFFSET_OFFSET
]

var GL_ARRAY_BUFFER$2 = 34962
var GL_ELEMENT_ARRAY_BUFFER$2 = 34963

var GL_FRAGMENT_SHADER$1 = 35632
var GL_VERTEX_SHADER$1 = 35633

var GL_TEXTURE_2D$3 = 0x0DE1
var GL_TEXTURE_CUBE_MAP$2 = 0x8513

var GL_CULL_FACE = 0x0B44
var GL_BLEND = 0x0BE2
var GL_DITHER = 0x0BD0
var GL_STENCIL_TEST = 0x0B90
var GL_DEPTH_TEST = 0x0B71
var GL_SCISSOR_TEST = 0x0C11
var GL_POLYGON_OFFSET_FILL = 0x8037
var GL_SAMPLE_ALPHA_TO_COVERAGE = 0x809E
var GL_SAMPLE_COVERAGE = 0x80A0

var GL_FLOAT$8 = 5126
var GL_FLOAT_VEC2 = 35664
var GL_FLOAT_VEC3 = 35665
var GL_FLOAT_VEC4 = 35666
var GL_INT$3 = 5124
var GL_INT_VEC2 = 35667
var GL_INT_VEC3 = 35668
var GL_INT_VEC4 = 35669
var GL_BOOL = 35670
var GL_BOOL_VEC2 = 35671
var GL_BOOL_VEC3 = 35672
var GL_BOOL_VEC4 = 35673
var GL_FLOAT_MAT2 = 35674
var GL_FLOAT_MAT3 = 35675
var GL_FLOAT_MAT4 = 35676
var GL_SAMPLER_2D = 35678
var GL_SAMPLER_CUBE = 35680

var GL_TRIANGLES$1 = 4

var GL_FRONT = 1028
var GL_BACK = 1029
var GL_CW = 0x0900
var GL_CCW = 0x0901
var GL_MIN_EXT = 0x8007
var GL_MAX_EXT = 0x8008
var GL_ALWAYS = 519
var GL_KEEP = 7680
var GL_ZERO = 0
var GL_ONE = 1
var GL_FUNC_ADD = 0x8006
var GL_LESS = 513

var GL_FRAMEBUFFER$2 = 0x8D40
var GL_COLOR_ATTACHMENT0$2 = 0x8CE0

var blendFuncs = {
  '0': 0,
  '1': 1,
  'zero': 0,
  'one': 1,
  'src color': 768,
  'one minus src color': 769,
  'src alpha': 770,
  'one minus src alpha': 771,
  'dst color': 774,
  'one minus dst color': 775,
  'dst alpha': 772,
  'one minus dst alpha': 773,
  'constant color': 32769,
  'one minus constant color': 32770,
  'constant alpha': 32771,
  'one minus constant alpha': 32772,
  'src alpha saturate': 776
}

// There are invalid values for srcRGB and dstRGB. See:
// https://www.khronos.org/registry/webgl/specs/1.0/#6.13
// https://github.com/KhronosGroup/WebGL/blob/0d3201f5f7ec3c0060bc1f04077461541f1987b9/conformance-suites/1.0.3/conformance/misc/webgl-specific.html#L56
var invalidBlendCombinations = [
  'constant color, constant alpha',
  'one minus constant color, constant alpha',
  'constant color, one minus constant alpha',
  'one minus constant color, one minus constant alpha',
  'constant alpha, constant color',
  'constant alpha, one minus constant color',
  'one minus constant alpha, constant color',
  'one minus constant alpha, one minus constant color'
]

var compareFuncs = {
  'never': 512,
  'less': 513,
  '<': 513,
  'equal': 514,
  '=': 514,
  '==': 514,
  '===': 514,
  'lequal': 515,
  '<=': 515,
  'greater': 516,
  '>': 516,
  'notequal': 517,
  '!=': 517,
  '!==': 517,
  'gequal': 518,
  '>=': 518,
  'always': 519
}

var stencilOps = {
  '0': 0,
  'zero': 0,
  'keep': 7680,
  'replace': 7681,
  'increment': 7682,
  'decrement': 7683,
  'increment wrap': 34055,
  'decrement wrap': 34056,
  'invert': 5386
}

var shaderType = {
  'frag': GL_FRAGMENT_SHADER$1,
  'vert': GL_VERTEX_SHADER$1
}

var orientationType = {
  'cw': GL_CW,
  'ccw': GL_CCW
}

function isBufferArgs (x) {
  return Array.isArray(x) ||
    isTypedArray(x) ||
    isNDArrayLike(x)
}

// Make sure viewport is processed first
function sortState (state) {
  return state.sort(function (a, b) {
    if (a === S_VIEWPORT) {
      return -1
    } else if (b === S_VIEWPORT) {
      return 1
    }
    return (a < b) ? -1 : 1
  })
}

function Declaration (thisDep, contextDep, propDep, append) {
  this.thisDep = thisDep
  this.contextDep = contextDep
  this.propDep = propDep
  this.append = append
}

function isStatic (decl) {
  return decl && !(decl.thisDep || decl.contextDep || decl.propDep)
}

function createStaticDecl (append) {
  return new Declaration(false, false, false, append)
}

function createDynamicDecl (dyn, append) {
  var type = dyn.type
  if (type === DYN_FUNC$1) {
    var numArgs = dyn.data.length
    return new Declaration(
      true,
      numArgs >= 1,
      numArgs >= 2,
      append)
  } else if (type === DYN_THUNK) {
    var data = dyn.data
    return new Declaration(
      data.thisDep,
      data.contextDep,
      data.propDep,
      append)
  } else if (type === DYN_CONSTANT$1) {
    return new Declaration(
      false,
      false,
      false,
      append)
  } else if (type === DYN_ARRAY$1) {
    var thisDep = false
    var contextDep = false
    var propDep = false
    for (var i = 0; i < dyn.data.length; ++i) {
      var subDyn = dyn.data[i]
      if (subDyn.type === DYN_PROP$1) {
        propDep = true
      } else if (subDyn.type === DYN_CONTEXT$1) {
        contextDep = true
      } else if (subDyn.type === DYN_STATE$1) {
        thisDep = true
      } else if (subDyn.type === DYN_FUNC$1) {
        thisDep = true
        var subArgs = subDyn.data
        if (subArgs >= 1) {
          contextDep = true
        }
        if (subArgs >= 2) {
          propDep = true
        }
      } else if (subDyn.type === DYN_THUNK) {
        thisDep = thisDep || subDyn.data.thisDep
        contextDep = contextDep || subDyn.data.contextDep
        propDep = propDep || subDyn.data.propDep
      }
    }
    return new Declaration(
      thisDep,
      contextDep,
      propDep,
      append)
  } else {
    return new Declaration(
      type === DYN_STATE$1,
      type === DYN_CONTEXT$1,
      type === DYN_PROP$1,
      append)
  }
}

var SCOPE_DECL = new Declaration(false, false, false, function () {})

function reglCore (
  gl,
  stringStore,
  extensions,
  limits,
  bufferState,
  elementState,
  textureState,
  framebufferState,
  uniformState,
  attributeState,
  shaderState,
  drawState,
  contextState,
  timer,
  config) {
  var AttributeRecord = attributeState.Record

  var blendEquations = {
    'add': 32774,
    'subtract': 32778,
    'reverse subtract': 32779
  }
  if (extensions.ext_blend_minmax) {
    blendEquations.min = GL_MIN_EXT
    blendEquations.max = GL_MAX_EXT
  }

  var extInstancing = extensions.angle_instanced_arrays
  var extDrawBuffers = extensions.webgl_draw_buffers
  var extVertexArrays = extensions.oes_vertex_array_object

  // ===================================================
  // ===================================================
  // WEBGL STATE
  // ===================================================
  // ===================================================
  var currentState = {
    dirty: true,
    profile: config.profile
  }
  var nextState = {}
  var GL_STATE_NAMES = []
  var GL_FLAGS = {}
  var GL_VARIABLES = {}

  function propName (name) {
    return name.replace('.', '_')
  }

  function stateFlag (sname, cap, init) {
    var name = propName(sname)
    GL_STATE_NAMES.push(sname)
    nextState[name] = currentState[name] = !!init
    GL_FLAGS[name] = cap
  }

  function stateVariable (sname, func, init) {
    var name = propName(sname)
    GL_STATE_NAMES.push(sname)
    if (Array.isArray(init)) {
      currentState[name] = init.slice()
      nextState[name] = init.slice()
    } else {
      currentState[name] = nextState[name] = init
    }
    GL_VARIABLES[name] = func
  }

  // Dithering
  stateFlag(S_DITHER, GL_DITHER)

  // Blending
  stateFlag(S_BLEND_ENABLE, GL_BLEND)
  stateVariable(S_BLEND_COLOR, 'blendColor', [0, 0, 0, 0])
  stateVariable(S_BLEND_EQUATION, 'blendEquationSeparate',
    [GL_FUNC_ADD, GL_FUNC_ADD])
  stateVariable(S_BLEND_FUNC, 'blendFuncSeparate',
    [GL_ONE, GL_ZERO, GL_ONE, GL_ZERO])

  // Depth
  stateFlag(S_DEPTH_ENABLE, GL_DEPTH_TEST, true)
  stateVariable(S_DEPTH_FUNC, 'depthFunc', GL_LESS)
  stateVariable(S_DEPTH_RANGE, 'depthRange', [0, 1])
  stateVariable(S_DEPTH_MASK, 'depthMask', true)

  // Color mask
  stateVariable(S_COLOR_MASK, S_COLOR_MASK, [true, true, true, true])

  // Face culling
  stateFlag(S_CULL_ENABLE, GL_CULL_FACE)
  stateVariable(S_CULL_FACE, 'cullFace', GL_BACK)

  // Front face orientation
  stateVariable(S_FRONT_FACE, S_FRONT_FACE, GL_CCW)

  // Line width
  stateVariable(S_LINE_WIDTH, S_LINE_WIDTH, 1)

  // Polygon offset
  stateFlag(S_POLYGON_OFFSET_ENABLE, GL_POLYGON_OFFSET_FILL)
  stateVariable(S_POLYGON_OFFSET_OFFSET, 'polygonOffset', [0, 0])

  // Sample coverage
  stateFlag(S_SAMPLE_ALPHA, GL_SAMPLE_ALPHA_TO_COVERAGE)
  stateFlag(S_SAMPLE_ENABLE, GL_SAMPLE_COVERAGE)
  stateVariable(S_SAMPLE_COVERAGE, 'sampleCoverage', [1, false])

  // Stencil
  stateFlag(S_STENCIL_ENABLE, GL_STENCIL_TEST)
  stateVariable(S_STENCIL_MASK, 'stencilMask', -1)
  stateVariable(S_STENCIL_FUNC, 'stencilFunc', [GL_ALWAYS, 0, -1])
  stateVariable(S_STENCIL_OPFRONT, 'stencilOpSeparate',
    [GL_FRONT, GL_KEEP, GL_KEEP, GL_KEEP])
  stateVariable(S_STENCIL_OPBACK, 'stencilOpSeparate',
    [GL_BACK, GL_KEEP, GL_KEEP, GL_KEEP])

  // Scissor
  stateFlag(S_SCISSOR_ENABLE, GL_SCISSOR_TEST)
  stateVariable(S_SCISSOR_BOX, 'scissor',
    [0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight])

  // Viewport
  stateVariable(S_VIEWPORT, S_VIEWPORT,
    [0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight])

  // ===================================================
  // ===================================================
  // ENVIRONMENT
  // ===================================================
  // ===================================================
  var sharedState = {
    gl: gl,
    context: contextState,
    strings: stringStore,
    next: nextState,
    current: currentState,
    draw: drawState,
    elements: elementState,
    buffer: bufferState,
    shader: shaderState,
    attributes: attributeState.state,
    vao: attributeState,
    uniforms: uniformState,
    framebuffer: framebufferState,
    extensions: extensions,

    timer: timer,
    isBufferArgs: isBufferArgs
  }

  var sharedConstants = {
    primTypes: primTypes,
    compareFuncs: compareFuncs,
    blendFuncs: blendFuncs,
    blendEquations: blendEquations,
    stencilOps: stencilOps,
    glTypes: glTypes,
    orientationType: orientationType
  }

  check$1.optional(function () {
    sharedState.isArrayLike = isArrayLike
  })

  if (extDrawBuffers) {
    sharedConstants.backBuffer = [GL_BACK]
    sharedConstants.drawBuffer = loop(limits.maxDrawbuffers, function (i) {
      if (i === 0) {
        return [0]
      }
      return loop(i, function (j) {
        return GL_COLOR_ATTACHMENT0$2 + j
      })
    })
  }

  var drawCallCounter = 0
  function createREGLEnvironment () {
    var env = createEnvironment()
    var link = env.link
    var global = env.global
    env.id = drawCallCounter++

    env.batchId = '0'

    // link shared state
    var SHARED = link(sharedState)
    var shared = env.shared = {
      props: 'a0'
    }
    sortedObjectKeys(sharedState).forEach(function (prop) {
      shared[prop] = global.def(SHARED, '.', prop)
    })

    // Inject runtime assertion stuff for debug builds
    check$1.optional(function () {
      env.CHECK = link(check$1)
      env.commandStr = check$1.guessCommand()
      env.command = link(env.commandStr)
      env.assert = function (block, pred, message) {
        block(
          'if(!(', pred, '))',
          this.CHECK, '.commandRaise(', link(message), ',', this.command, ');')
      }

      sharedConstants.invalidBlendCombinations = invalidBlendCombinations
    })

    // Copy GL state variables over
    var nextVars = env.next = {}
    var currentVars = env.current = {}
    sortedObjectKeys(GL_VARIABLES).forEach(function (variable) {
      if (Array.isArray(currentState[variable])) {
        nextVars[variable] = global.def(shared.next, '.', variable)
        currentVars[variable] = global.def(shared.current, '.', variable)
      }
    })

    // Initialize shared constants
    var constants = env.constants = {}
    sortedObjectKeys(sharedConstants).forEach(function (name) {
      constants[name] = global.def(JSON.stringify(sharedConstants[name]))
    })

    // Helper function for calling a block
    env.invoke = function (block, x) {
      switch (x.type) {
        case DYN_FUNC$1:
          var argList = [
            'this',
            shared.context,
            shared.props,
            env.batchId
          ]
          return block.def(
            link(x.data), '.call(',
            argList.slice(0, Math.max(x.data.length + 1, 4)),
            ')')
        case DYN_PROP$1:
          return block.def(shared.props, x.data)
        case DYN_CONTEXT$1:
          return block.def(shared.context, x.data)
        case DYN_STATE$1:
          return block.def('this', x.data)
        case DYN_THUNK:
          x.data.append(env, block)
          return x.data.ref
        case DYN_CONSTANT$1:
          return x.data.toString()
        case DYN_ARRAY$1:
          return x.data.map(function (y) {
            return env.invoke(block, y)
          })
      }
    }

    env.attribCache = {}

    var scopeAttribs = {}
    env.scopeAttrib = function (name) {
      var id = stringStore.id(name)
      if (id in scopeAttribs) {
        return scopeAttribs[id]
      }
      var binding = attributeState.scope[id]
      if (!binding) {
        binding = attributeState.scope[id] = new AttributeRecord()
      }
      var result = scopeAttribs[id] = link(binding)
      return result
    }

    return env
  }

  // ===================================================
  // ===================================================
  // PARSING
  // ===================================================
  // ===================================================
  function parseProfile (options) {
    var staticOptions = options.static
    var dynamicOptions = options.dynamic

    var profileEnable
    if (S_PROFILE in staticOptions) {
      var value = !!staticOptions[S_PROFILE]
      profileEnable = createStaticDecl(function (env, scope) {
        return value
      })
      profileEnable.enable = value
    } else if (S_PROFILE in dynamicOptions) {
      var dyn = dynamicOptions[S_PROFILE]
      profileEnable = createDynamicDecl(dyn, function (env, scope) {
        return env.invoke(scope, dyn)
      })
    }

    return profileEnable
  }

  function parseFramebuffer (options, env) {
    var staticOptions = options.static
    var dynamicOptions = options.dynamic

    if (S_FRAMEBUFFER in staticOptions) {
      var framebuffer = staticOptions[S_FRAMEBUFFER]
      if (framebuffer) {
        framebuffer = framebufferState.getFramebuffer(framebuffer)
        check$1.command(framebuffer, 'invalid framebuffer object')
        return createStaticDecl(function (env, block) {
          var FRAMEBUFFER = env.link(framebuffer)
          var shared = env.shared
          block.set(
            shared.framebuffer,
            '.next',
            FRAMEBUFFER)
          var CONTEXT = shared.context
          block.set(
            CONTEXT,
            '.' + S_FRAMEBUFFER_WIDTH,
            FRAMEBUFFER + '.width')
          block.set(
            CONTEXT,
            '.' + S_FRAMEBUFFER_HEIGHT,
            FRAMEBUFFER + '.height')
          return FRAMEBUFFER
        })
      } else {
        return createStaticDecl(function (env, scope) {
          var shared = env.shared
          scope.set(
            shared.framebuffer,
            '.next',
            'null')
          var CONTEXT = shared.context
          scope.set(
            CONTEXT,
            '.' + S_FRAMEBUFFER_WIDTH,
            CONTEXT + '.' + S_DRAWINGBUFFER_WIDTH)
          scope.set(
            CONTEXT,
            '.' + S_FRAMEBUFFER_HEIGHT,
            CONTEXT + '.' + S_DRAWINGBUFFER_HEIGHT)
          return 'null'
        })
      }
    } else if (S_FRAMEBUFFER in dynamicOptions) {
      var dyn = dynamicOptions[S_FRAMEBUFFER]
      return createDynamicDecl(dyn, function (env, scope) {
        var FRAMEBUFFER_FUNC = env.invoke(scope, dyn)
        var shared = env.shared
        var FRAMEBUFFER_STATE = shared.framebuffer
        var FRAMEBUFFER = scope.def(
          FRAMEBUFFER_STATE, '.getFramebuffer(', FRAMEBUFFER_FUNC, ')')

        check$1.optional(function () {
          env.assert(scope,
            '!' + FRAMEBUFFER_FUNC + '||' + FRAMEBUFFER,
            'invalid framebuffer object')
        })

        scope.set(
          FRAMEBUFFER_STATE,
          '.next',
          FRAMEBUFFER)
        var CONTEXT = shared.context
        scope.set(
          CONTEXT,
          '.' + S_FRAMEBUFFER_WIDTH,
          FRAMEBUFFER + '?' + FRAMEBUFFER + '.width:' +
          CONTEXT + '.' + S_DRAWINGBUFFER_WIDTH)
        scope.set(
          CONTEXT,
          '.' + S_FRAMEBUFFER_HEIGHT,
          FRAMEBUFFER +
          '?' + FRAMEBUFFER + '.height:' +
          CONTEXT + '.' + S_DRAWINGBUFFER_HEIGHT)
        return FRAMEBUFFER
      })
    } else {
      return null
    }
  }

  function parseViewportScissor (options, framebuffer, env) {
    var staticOptions = options.static
    var dynamicOptions = options.dynamic

    function parseBox (param) {
      if (param in staticOptions) {
        var box = staticOptions[param]
        check$1.commandType(box, 'object', 'invalid ' + param, env.commandStr)

        var isStatic = true
        var x = box.x | 0
        var y = box.y | 0
        var w, h
        if ('width' in box) {
          w = box.width | 0
          check$1.command(w >= 0, 'invalid ' + param, env.commandStr)
        } else {
          isStatic = false
        }
        if ('height' in box) {
          h = box.height | 0
          check$1.command(h >= 0, 'invalid ' + param, env.commandStr)
        } else {
          isStatic = false
        }

        return new Declaration(
          !isStatic && framebuffer && framebuffer.thisDep,
          !isStatic && framebuffer && framebuffer.contextDep,
          !isStatic && framebuffer && framebuffer.propDep,
          function (env, scope) {
            var CONTEXT = env.shared.context
            var BOX_W = w
            if (!('width' in box)) {
              BOX_W = scope.def(CONTEXT, '.', S_FRAMEBUFFER_WIDTH, '-', x)
            }
            var BOX_H = h
            if (!('height' in box)) {
              BOX_H = scope.def(CONTEXT, '.', S_FRAMEBUFFER_HEIGHT, '-', y)
            }
            return [x, y, BOX_W, BOX_H]
          })
      } else if (param in dynamicOptions) {
        var dynBox = dynamicOptions[param]
        var result = createDynamicDecl(dynBox, function (env, scope) {
          var BOX = env.invoke(scope, dynBox)

          check$1.optional(function () {
            env.assert(scope,
              BOX + '&&typeof ' + BOX + '==="object"',
              'invalid ' + param)
          })

          var CONTEXT = env.shared.context
          var BOX_X = scope.def(BOX, '.x|0')
          var BOX_Y = scope.def(BOX, '.y|0')
          var BOX_W = scope.def(
            '"width" in ', BOX, '?', BOX, '.width|0:',
            '(', CONTEXT, '.', S_FRAMEBUFFER_WIDTH, '-', BOX_X, ')')
          var BOX_H = scope.def(
            '"height" in ', BOX, '?', BOX, '.height|0:',
            '(', CONTEXT, '.', S_FRAMEBUFFER_HEIGHT, '-', BOX_Y, ')')

          check$1.optional(function () {
            env.assert(scope,
              BOX_W + '>=0&&' +
              BOX_H + '>=0',
              'invalid ' + param)
          })

          return [BOX_X, BOX_Y, BOX_W, BOX_H]
        })
        if (framebuffer) {
          result.thisDep = result.thisDep || framebuffer.thisDep
          result.contextDep = result.contextDep || framebuffer.contextDep
          result.propDep = result.propDep || framebuffer.propDep
        }
        return result
      } else if (framebuffer) {
        return new Declaration(
          framebuffer.thisDep,
          framebuffer.contextDep,
          framebuffer.propDep,
          function (env, scope) {
            var CONTEXT = env.shared.context
            return [
              0, 0,
              scope.def(CONTEXT, '.', S_FRAMEBUFFER_WIDTH),
              scope.def(CONTEXT, '.', S_FRAMEBUFFER_HEIGHT)]
          })
      } else {
        return null
      }
    }

    var viewport = parseBox(S_VIEWPORT)

    if (viewport) {
      var prevViewport = viewport
      viewport = new Declaration(
        viewport.thisDep,
        viewport.contextDep,
        viewport.propDep,
        function (env, scope) {
          var VIEWPORT = prevViewport.append(env, scope)
          var CONTEXT = env.shared.context
          scope.set(
            CONTEXT,
            '.' + S_VIEWPORT_WIDTH,
            VIEWPORT[2])
          scope.set(
            CONTEXT,
            '.' + S_VIEWPORT_HEIGHT,
            VIEWPORT[3])
          return VIEWPORT
        })
    }

    return {
      viewport: viewport,
      scissor_box: parseBox(S_SCISSOR_BOX)
    }
  }

  function parseAttribLocations (options, attributes) {
    var staticOptions = options.static
    var staticProgram =
      typeof staticOptions[S_FRAG] === 'string' &&
      typeof staticOptions[S_VERT] === 'string'
    if (staticProgram) {
      if (sortedObjectKeys(attributes.dynamic).length > 0) {
        return null
      }
      var staticAttributes = attributes.static
      var sAttributes = sortedObjectKeys(staticAttributes)
      if (sAttributes.length > 0 && typeof staticAttributes[sAttributes[0]] === 'number') {
        var bindings = []
        for (var i = 0; i < sAttributes.length; ++i) {
          check$1(typeof staticAttributes[sAttributes[i]] === 'number', 'must specify all vertex attribute locations when using vaos')
          bindings.push([staticAttributes[sAttributes[i]] | 0, sAttributes[i]])
        }
        return bindings
      }
    }
    return null
  }

  function parseProgram (options, env, attribLocations) {
    var staticOptions = options.static
    var dynamicOptions = options.dynamic

    function parseShader (name) {
      if (name in staticOptions) {
        var id = stringStore.id(staticOptions[name])
        check$1.optional(function () {
          shaderState.shader(shaderType[name], id, check$1.guessCommand())
        })
        var result = createStaticDecl(function () {
          return id
        })
        result.id = id
        return result
      } else if (name in dynamicOptions) {
        var dyn = dynamicOptions[name]
        return createDynamicDecl(dyn, function (env, scope) {
          var str = env.invoke(scope, dyn)
          var id = scope.def(env.shared.strings, '.id(', str, ')')
          check$1.optional(function () {
            scope(
              env.shared.shader, '.shader(',
              shaderType[name], ',',
              id, ',',
              env.command, ');')
          })
          return id
        })
      }
      return null
    }

    var frag = parseShader(S_FRAG)
    var vert = parseShader(S_VERT)

    var program = null
    var progVar
    if (isStatic(frag) && isStatic(vert)) {
      program = shaderState.program(vert.id, frag.id, null, attribLocations)
      progVar = createStaticDecl(function (env, scope) {
        return env.link(program)
      })
    } else {
      progVar = new Declaration(
        (frag && frag.thisDep) || (vert && vert.thisDep),
        (frag && frag.contextDep) || (vert && vert.contextDep),
        (frag && frag.propDep) || (vert && vert.propDep),
        function (env, scope) {
          var SHADER_STATE = env.shared.shader
          var fragId
          if (frag) {
            fragId = frag.append(env, scope)
          } else {
            fragId = scope.def(SHADER_STATE, '.', S_FRAG)
          }
          var vertId
          if (vert) {
            vertId = vert.append(env, scope)
          } else {
            vertId = scope.def(SHADER_STATE, '.', S_VERT)
          }
          var progDef = SHADER_STATE + '.program(' + vertId + ',' + fragId
          check$1.optional(function () {
            progDef += ',' + env.command
          })
          return scope.def(progDef + ')')
        })
    }

    return {
      frag: frag,
      vert: vert,
      progVar: progVar,
      program: program
    }
  }

  function parseDraw (options, env) {
    var staticOptions = options.static
    var dynamicOptions = options.dynamic

    // TODO: should use VAO to get default values for offset properties
    // should move vao parse into here and out of the old stuff

    var staticDraw = {}
    var vaoActive = false

    function parseVAO () {
      if (S_VAO in staticOptions) {
        var vao = staticOptions[S_VAO]
        if (vao !== null && attributeState.getVAO(vao) === null) {
          vao = attributeState.createVAO(vao)
        }

        vaoActive = true
        staticDraw.vao = vao

        return createStaticDecl(function (env) {
          var vaoRef = attributeState.getVAO(vao)
          if (vaoRef) {
            return env.link(vaoRef)
          } else {
            return 'null'
          }
        })
      } else if (S_VAO in dynamicOptions) {
        vaoActive = true
        var dyn = dynamicOptions[S_VAO]
        return createDynamicDecl(dyn, function (env, scope) {
          var vaoRef = env.invoke(scope, dyn)
          return scope.def(env.shared.vao + '.getVAO(' + vaoRef + ')')
        })
      }
      return null
    }

    var vao = parseVAO()

    var elementsActive = false

    function parseElements () {
      if (S_ELEMENTS in staticOptions) {
        var elements = staticOptions[S_ELEMENTS]
        staticDraw.elements = elements
        if (isBufferArgs(elements)) {
          var e = staticDraw.elements = elementState.create(elements, true)
          elements = elementState.getElements(e)
          elementsActive = true
        } else if (elements) {
          elements = elementState.getElements(elements)
          elementsActive = true
          check$1.command(elements, 'invalid elements', env.commandStr)
        }

        var result = createStaticDecl(function (env, scope) {
          if (elements) {
            var result = env.link(elements)
            env.ELEMENTS = result
            return result
          }
          env.ELEMENTS = null
          return null
        })
        result.value = elements
        return result
      } else if (S_ELEMENTS in dynamicOptions) {
        elementsActive = true

        var dyn = dynamicOptions[S_ELEMENTS]
        return createDynamicDecl(dyn, function (env, scope) {
          var shared = env.shared

          var IS_BUFFER_ARGS = shared.isBufferArgs
          var ELEMENT_STATE = shared.elements

          var elementDefn = env.invoke(scope, dyn)
          var elements = scope.def('null')
          var elementStream = scope.def(IS_BUFFER_ARGS, '(', elementDefn, ')')

          var ifte = env.cond(elementStream)
            .then(elements, '=', ELEMENT_STATE, '.createStream(', elementDefn, ');')
            .else(elements, '=', ELEMENT_STATE, '.getElements(', elementDefn, ');')

          check$1.optional(function () {
            env.assert(ifte.else,
              '!' + elementDefn + '||' + elements,
              'invalid elements')
          })

          scope.entry(ifte)
          scope.exit(
            env.cond(elementStream)
              .then(ELEMENT_STATE, '.destroyStream(', elements, ');'))

          env.ELEMENTS = elements

          return elements
        })
      } else if (vaoActive) {
        return new Declaration(
          vao.thisDep,
          vao.contextDep,
          vao.propDep,
          function (env, scope) {
            return scope.def(env.shared.vao + '.currentVAO?' + env.shared.elements + '.getElements(' + env.shared.vao + '.currentVAO.elements):null')
          })
      }
      return null
    }

    var elements = parseElements()

    function parsePrimitive () {
      if (S_PRIMITIVE in staticOptions) {
        var primitive = staticOptions[S_PRIMITIVE]
        staticDraw.primitive = primitive
        check$1.commandParameter(primitive, primTypes, 'invalid primitve', env.commandStr)
        return createStaticDecl(function (env, scope) {
          return primTypes[primitive]
        })
      } else if (S_PRIMITIVE in dynamicOptions) {
        var dynPrimitive = dynamicOptions[S_PRIMITIVE]
        return createDynamicDecl(dynPrimitive, function (env, scope) {
          var PRIM_TYPES = env.constants.primTypes
          var prim = env.invoke(scope, dynPrimitive)
          check$1.optional(function () {
            env.assert(scope,
              prim + ' in ' + PRIM_TYPES,
              'invalid primitive, must be one of ' + sortedObjectKeys(primTypes))
          })
          return scope.def(PRIM_TYPES, '[', prim, ']')
        })
      } else if (elementsActive) {
        if (isStatic(elements)) {
          if (elements.value) {
            return createStaticDecl(function (env, scope) {
              return scope.def(env.ELEMENTS, '.primType')
            })
          } else {
            return createStaticDecl(function () {
              return GL_TRIANGLES$1
            })
          }
        } else {
          return new Declaration(
            elements.thisDep,
            elements.contextDep,
            elements.propDep,
            function (env, scope) {
              var elements = env.ELEMENTS
              return scope.def(elements, '?', elements, '.primType:', GL_TRIANGLES$1)
            })
        }
      } else if (vaoActive) {
        return new Declaration(
          vao.thisDep,
          vao.contextDep,
          vao.propDep,
          function (env, scope) {
            return scope.def(env.shared.vao + '.currentVAO?' + env.shared.vao + '.currentVAO.primitive:' + GL_TRIANGLES$1)
          })
      }
      return null
    }

    function parseParam (param, isOffset) {
      if (param in staticOptions) {
        var value = staticOptions[param] | 0
        if (isOffset) {
          staticDraw.offset = value
        } else {
          staticDraw.instances = value
        }
        check$1.command(!isOffset || value >= 0, 'invalid ' + param, env.commandStr)
        return createStaticDecl(function (env, scope) {
          if (isOffset) {
            env.OFFSET = value
          }
          return value
        })
      } else if (param in dynamicOptions) {
        var dynValue = dynamicOptions[param]
        return createDynamicDecl(dynValue, function (env, scope) {
          var result = env.invoke(scope, dynValue)
          if (isOffset) {
            env.OFFSET = result
            check$1.optional(function () {
              env.assert(scope,
                result + '>=0',
                'invalid ' + param)
            })
          }
          return result
        })
      } else if (isOffset) {
        if (elementsActive) {
          return createStaticDecl(function (env, scope) {
            env.OFFSET = 0
            return 0
          })
        } else if (vaoActive) {
          return new Declaration(
            vao.thisDep,
            vao.contextDep,
            vao.propDep,
            function (env, scope) {
              return scope.def(env.shared.vao + '.currentVAO?' + env.shared.vao + '.currentVAO.offset:0')
            })
        }
      } else if (vaoActive) {
        return new Declaration(
          vao.thisDep,
          vao.contextDep,
          vao.propDep,
          function (env, scope) {
            return scope.def(env.shared.vao + '.currentVAO?' + env.shared.vao + '.currentVAO.instances:-1')
          })
      }
      return null
    }

    var OFFSET = parseParam(S_OFFSET, true)

    function parseVertCount () {
      if (S_COUNT in staticOptions) {
        var count = staticOptions[S_COUNT] | 0
        staticDraw.count = count
        check$1.command(
          typeof count === 'number' && count >= 0, 'invalid vertex count', env.commandStr)
        return createStaticDecl(function () {
          return count
        })
      } else if (S_COUNT in dynamicOptions) {
        var dynCount = dynamicOptions[S_COUNT]
        return createDynamicDecl(dynCount, function (env, scope) {
          var result = env.invoke(scope, dynCount)
          check$1.optional(function () {
            env.assert(scope,
              'typeof ' + result + '==="number"&&' +
              result + '>=0&&' +
              result + '===(' + result + '|0)',
              'invalid vertex count')
          })
          return result
        })
      } else if (elementsActive) {
        if (isStatic(elements)) {
          if (elements) {
            if (OFFSET) {
              return new Declaration(
                OFFSET.thisDep,
                OFFSET.contextDep,
                OFFSET.propDep,
                function (env, scope) {
                  var result = scope.def(
                    env.ELEMENTS, '.vertCount-', env.OFFSET)

                  check$1.optional(function () {
                    env.assert(scope,
                      result + '>=0',
                      'invalid vertex offset/element buffer too small')
                  })

                  return result
                })
            } else {
              return createStaticDecl(function (env, scope) {
                return scope.def(env.ELEMENTS, '.vertCount')
              })
            }
          } else {
            var result = createStaticDecl(function () {
              return -1
            })
            check$1.optional(function () {
              result.MISSING = true
            })
            return result
          }
        } else {
          var variable = new Declaration(
            elements.thisDep || OFFSET.thisDep,
            elements.contextDep || OFFSET.contextDep,
            elements.propDep || OFFSET.propDep,
            function (env, scope) {
              var elements = env.ELEMENTS
              if (env.OFFSET) {
                return scope.def(elements, '?', elements, '.vertCount-',
                  env.OFFSET, ':-1')
              }
              return scope.def(elements, '?', elements, '.vertCount:-1')
            })
          check$1.optional(function () {
            variable.DYNAMIC = true
          })
          return variable
        }
      } else if (vaoActive) {
        var countVariable = new Declaration(
          vao.thisDep,
          vao.contextDep,
          vao.propDep,
          function (env, scope) {
            return scope.def(env.shared.vao, '.currentVAO?', env.shared.vao, '.currentVAO.count:-1')
          })
        return countVariable
      }
      return null
    }

    var primitive = parsePrimitive()
    var count = parseVertCount()
    var instances = parseParam(S_INSTANCES, false)

    return {
      elements: elements,
      primitive: primitive,
      count: count,
      instances: instances,
      offset: OFFSET,
      vao: vao,

      vaoActive: vaoActive,
      elementsActive: elementsActive,

      // static draw props
      static: staticDraw
    }
  }

  function parseGLState (options, env) {
    var staticOptions = options.static
    var dynamicOptions = options.dynamic

    var STATE = {}

    GL_STATE_NAMES.forEach(function (prop) {
      var param = propName(prop)

      function parseParam (parseStatic, parseDynamic) {
        if (prop in staticOptions) {
          var value = parseStatic(staticOptions[prop])
          STATE[param] = createStaticDecl(function () {
            return value
          })
        } else if (prop in dynamicOptions) {
          var dyn = dynamicOptions[prop]
          STATE[param] = createDynamicDecl(dyn, function (env, scope) {
            return parseDynamic(env, scope, env.invoke(scope, dyn))
          })
        }
      }

      switch (prop) {
        case S_CULL_ENABLE:
        case S_BLEND_ENABLE:
        case S_DITHER:
        case S_STENCIL_ENABLE:
        case S_DEPTH_ENABLE:
        case S_SCISSOR_ENABLE:
        case S_POLYGON_OFFSET_ENABLE:
        case S_SAMPLE_ALPHA:
        case S_SAMPLE_ENABLE:
        case S_DEPTH_MASK:
          return parseParam(
            function (value) {
              check$1.commandType(value, 'boolean', prop, env.commandStr)
              return value
            },
            function (env, scope, value) {
              check$1.optional(function () {
                env.assert(scope,
                  'typeof ' + value + '==="boolean"',
                  'invalid flag ' + prop, env.commandStr)
              })
              return value
            })

        case S_DEPTH_FUNC:
          return parseParam(
            function (value) {
              check$1.commandParameter(value, compareFuncs, 'invalid ' + prop, env.commandStr)
              return compareFuncs[value]
            },
            function (env, scope, value) {
              var COMPARE_FUNCS = env.constants.compareFuncs
              check$1.optional(function () {
                env.assert(scope,
                  value + ' in ' + COMPARE_FUNCS,
                  'invalid ' + prop + ', must be one of ' + sortedObjectKeys(compareFuncs))
              })
              return scope.def(COMPARE_FUNCS, '[', value, ']')
            })

        case S_DEPTH_RANGE:
          return parseParam(
            function (value) {
              check$1.command(
                isArrayLike(value) &&
                value.length === 2 &&
                typeof value[0] === 'number' &&
                typeof value[1] === 'number' &&
                value[0] <= value[1],
                'depth range is 2d array',
                env.commandStr)
              return value
            },
            function (env, scope, value) {
              check$1.optional(function () {
                env.assert(scope,
                  env.shared.isArrayLike + '(' + value + ')&&' +
                  value + '.length===2&&' +
                  'typeof ' + value + '[0]==="number"&&' +
                  'typeof ' + value + '[1]==="number"&&' +
                  value + '[0]<=' + value + '[1]',
                  'depth range must be a 2d array')
              })

              var Z_NEAR = scope.def('+', value, '[0]')
              var Z_FAR = scope.def('+', value, '[1]')
              return [Z_NEAR, Z_FAR]
            })

        case S_BLEND_FUNC:
          return parseParam(
            function (value) {
              check$1.commandType(value, 'object', 'blend.func', env.commandStr)
              var srcRGB = ('srcRGB' in value ? value.srcRGB : value.src)
              var srcAlpha = ('srcAlpha' in value ? value.srcAlpha : value.src)
              var dstRGB = ('dstRGB' in value ? value.dstRGB : value.dst)
              var dstAlpha = ('dstAlpha' in value ? value.dstAlpha : value.dst)
              check$1.commandParameter(srcRGB, blendFuncs, param + '.srcRGB', env.commandStr)
              check$1.commandParameter(srcAlpha, blendFuncs, param + '.srcAlpha', env.commandStr)
              check$1.commandParameter(dstRGB, blendFuncs, param + '.dstRGB', env.commandStr)
              check$1.commandParameter(dstAlpha, blendFuncs, param + '.dstAlpha', env.commandStr)

              check$1.command(
                (invalidBlendCombinations.indexOf(srcRGB + ', ' + dstRGB) === -1),
                'unallowed blending combination (srcRGB, dstRGB) = (' + srcRGB + ', ' + dstRGB + ')', env.commandStr)

              return [
                blendFuncs[srcRGB],
                blendFuncs[dstRGB],
                blendFuncs[srcAlpha],
                blendFuncs[dstAlpha]
              ]
            },
            function (env, scope, value) {
              var BLEND_FUNCS = env.constants.blendFuncs

              check$1.optional(function () {
                env.assert(scope,
                  value + '&&typeof ' + value + '==="object"',
                  'invalid blend func, must be an object')
              })

              function read (prefix, suffix) {
                var func = scope.def(
                  '"', prefix, suffix, '" in ', value,
                  '?', value, '.', prefix, suffix,
                  ':', value, '.', prefix)

                check$1.optional(function () {
                  env.assert(scope,
                    func + ' in ' + BLEND_FUNCS,
                    'invalid ' + prop + '.' + prefix + suffix + ', must be one of ' + sortedObjectKeys(blendFuncs))
                })

                return func
              }

              var srcRGB = read('src', 'RGB')
              var dstRGB = read('dst', 'RGB')

              check$1.optional(function () {
                var INVALID_BLEND_COMBINATIONS = env.constants.invalidBlendCombinations

                env.assert(scope,
                  INVALID_BLEND_COMBINATIONS +
                           '.indexOf(' + srcRGB + '+", "+' + dstRGB + ') === -1 ',
                  'unallowed blending combination for (srcRGB, dstRGB)'
                )
              })

              var SRC_RGB = scope.def(BLEND_FUNCS, '[', srcRGB, ']')
              var SRC_ALPHA = scope.def(BLEND_FUNCS, '[', read('src', 'Alpha'), ']')
              var DST_RGB = scope.def(BLEND_FUNCS, '[', dstRGB, ']')
              var DST_ALPHA = scope.def(BLEND_FUNCS, '[', read('dst', 'Alpha'), ']')

              return [SRC_RGB, DST_RGB, SRC_ALPHA, DST_ALPHA]
            })

        case S_BLEND_EQUATION:
          return parseParam(
            function (value) {
              if (typeof value === 'string') {
                check$1.commandParameter(value, blendEquations, 'invalid ' + prop, env.commandStr)
                return [
                  blendEquations[value],
                  blendEquations[value]
                ]
              } else if (typeof value === 'object') {
                check$1.commandParameter(
                  value.rgb, blendEquations, prop + '.rgb', env.commandStr)
                check$1.commandParameter(
                  value.alpha, blendEquations, prop + '.alpha', env.commandStr)
                return [
                  blendEquations[value.rgb],
                  blendEquations[value.alpha]
                ]
              } else {
                check$1.commandRaise('invalid blend.equation', env.commandStr)
              }
            },
            function (env, scope, value) {
              var BLEND_EQUATIONS = env.constants.blendEquations

              var RGB = scope.def()
              var ALPHA = scope.def()

              var ifte = env.cond('typeof ', value, '==="string"')

              check$1.optional(function () {
                function checkProp (block, name, value) {
                  env.assert(block,
                    value + ' in ' + BLEND_EQUATIONS,
                    'invalid ' + name + ', must be one of ' + sortedObjectKeys(blendEquations))
                }
                checkProp(ifte.then, prop, value)

                env.assert(ifte.else,
                  value + '&&typeof ' + value + '==="object"',
                  'invalid ' + prop)
                checkProp(ifte.else, prop + '.rgb', value + '.rgb')
                checkProp(ifte.else, prop + '.alpha', value + '.alpha')
              })

              ifte.then(
                RGB, '=', ALPHA, '=', BLEND_EQUATIONS, '[', value, '];')
              ifte.else(
                RGB, '=', BLEND_EQUATIONS, '[', value, '.rgb];',
                ALPHA, '=', BLEND_EQUATIONS, '[', value, '.alpha];')

              scope(ifte)

              return [RGB, ALPHA]
            })

        case S_BLEND_COLOR:
          return parseParam(
            function (value) {
              check$1.command(
                isArrayLike(value) &&
                value.length === 4,
                'blend.color must be a 4d array', env.commandStr)
              return loop(4, function (i) {
                return +value[i]
              })
            },
            function (env, scope, value) {
              check$1.optional(function () {
                env.assert(scope,
                  env.shared.isArrayLike + '(' + value + ')&&' +
                  value + '.length===4',
                  'blend.color must be a 4d array')
              })
              return loop(4, function (i) {
                return scope.def('+', value, '[', i, ']')
              })
            })

        case S_STENCIL_MASK:
          return parseParam(
            function (value) {
              check$1.commandType(value, 'number', param, env.commandStr)
              return value | 0
            },
            function (env, scope, value) {
              check$1.optional(function () {
                env.assert(scope,
                  'typeof ' + value + '==="number"',
                  'invalid stencil.mask')
              })
              return scope.def(value, '|0')
            })

        case S_STENCIL_FUNC:
          return parseParam(
            function (value) {
              check$1.commandType(value, 'object', param, env.commandStr)
              var cmp = value.cmp || 'keep'
              var ref = value.ref || 0
              var mask = 'mask' in value ? value.mask : -1
              check$1.commandParameter(cmp, compareFuncs, prop + '.cmp', env.commandStr)
              check$1.commandType(ref, 'number', prop + '.ref', env.commandStr)
              check$1.commandType(mask, 'number', prop + '.mask', env.commandStr)
              return [
                compareFuncs[cmp],
                ref,
                mask
              ]
            },
            function (env, scope, value) {
              var COMPARE_FUNCS = env.constants.compareFuncs
              check$1.optional(function () {
                function assert () {
                  env.assert(scope,
                    Array.prototype.join.call(arguments, ''),
                    'invalid stencil.func')
                }
                assert(value + '&&typeof ', value, '==="object"')
                assert('!("cmp" in ', value, ')||(',
                  value, '.cmp in ', COMPARE_FUNCS, ')')
              })
              var cmp = scope.def(
                '"cmp" in ', value,
                '?', COMPARE_FUNCS, '[', value, '.cmp]',
                ':', GL_KEEP)
              var ref = scope.def(value, '.ref|0')
              var mask = scope.def(
                '"mask" in ', value,
                '?', value, '.mask|0:-1')
              return [cmp, ref, mask]
            })

        case S_STENCIL_OPFRONT:
        case S_STENCIL_OPBACK:
          return parseParam(
            function (value) {
              check$1.commandType(value, 'object', param, env.commandStr)
              var fail = value.fail || 'keep'
              var zfail = value.zfail || 'keep'
              var zpass = value.zpass || 'keep'
              check$1.commandParameter(fail, stencilOps, prop + '.fail', env.commandStr)
              check$1.commandParameter(zfail, stencilOps, prop + '.zfail', env.commandStr)
              check$1.commandParameter(zpass, stencilOps, prop + '.zpass', env.commandStr)
              return [
                prop === S_STENCIL_OPBACK ? GL_BACK : GL_FRONT,
                stencilOps[fail],
                stencilOps[zfail],
                stencilOps[zpass]
              ]
            },
            function (env, scope, value) {
              var STENCIL_OPS = env.constants.stencilOps

              check$1.optional(function () {
                env.assert(scope,
                  value + '&&typeof ' + value + '==="object"',
                  'invalid ' + prop)
              })

              function read (name) {
                check$1.optional(function () {
                  env.assert(scope,
                    '!("' + name + '" in ' + value + ')||' +
                    '(' + value + '.' + name + ' in ' + STENCIL_OPS + ')',
                    'invalid ' + prop + '.' + name + ', must be one of ' + sortedObjectKeys(stencilOps))
                })

                return scope.def(
                  '"', name, '" in ', value,
                  '?', STENCIL_OPS, '[', value, '.', name, ']:',
                  GL_KEEP)
              }

              return [
                prop === S_STENCIL_OPBACK ? GL_BACK : GL_FRONT,
                read('fail'),
                read('zfail'),
                read('zpass')
              ]
            })

        case S_POLYGON_OFFSET_OFFSET:
          return parseParam(
            function (value) {
              check$1.commandType(value, 'object', param, env.commandStr)
              var factor = value.factor | 0
              var units = value.units | 0
              check$1.commandType(factor, 'number', param + '.factor', env.commandStr)
              check$1.commandType(units, 'number', param + '.units', env.commandStr)
              return [factor, units]
            },
            function (env, scope, value) {
              check$1.optional(function () {
                env.assert(scope,
                  value + '&&typeof ' + value + '==="object"',
                  'invalid ' + prop)
              })

              var FACTOR = scope.def(value, '.factor|0')
              var UNITS = scope.def(value, '.units|0')

              return [FACTOR, UNITS]
            })

        case S_CULL_FACE:
          return parseParam(
            function (value) {
              var face = 0
              if (value === 'front') {
                face = GL_FRONT
              } else if (value === 'back') {
                face = GL_BACK
              }
              check$1.command(!!face, param, env.commandStr)
              return face
            },
            function (env, scope, value) {
              check$1.optional(function () {
                env.assert(scope,
                  value + '==="front"||' +
                  value + '==="back"',
                  'invalid cull.face')
              })
              return scope.def(value, '==="front"?', GL_FRONT, ':', GL_BACK)
            })

        case S_LINE_WIDTH:
          return parseParam(
            function (value) {
              check$1.command(
                typeof value === 'number' &&
                value >= limits.lineWidthDims[0] &&
                value <= limits.lineWidthDims[1],
                'invalid line width, must be a positive number between ' +
                limits.lineWidthDims[0] + ' and ' + limits.lineWidthDims[1], env.commandStr)
              return value
            },
            function (env, scope, value) {
              check$1.optional(function () {
                env.assert(scope,
                  'typeof ' + value + '==="number"&&' +
                  value + '>=' + limits.lineWidthDims[0] + '&&' +
                  value + '<=' + limits.lineWidthDims[1],
                  'invalid line width')
              })

              return value
            })

        case S_FRONT_FACE:
          return parseParam(
            function (value) {
              check$1.commandParameter(value, orientationType, param, env.commandStr)
              return orientationType[value]
            },
            function (env, scope, value) {
              check$1.optional(function () {
                env.assert(scope,
                  value + '==="cw"||' +
                  value + '==="ccw"',
                  'invalid frontFace, must be one of cw,ccw')
              })
              return scope.def(value + '==="cw"?' + GL_CW + ':' + GL_CCW)
            })

        case S_COLOR_MASK:
          return parseParam(
            function (value) {
              check$1.command(
                isArrayLike(value) && value.length === 4,
                'color.mask must be length 4 array', env.commandStr)
              return value.map(function (v) { return !!v })
            },
            function (env, scope, value) {
              check$1.optional(function () {
                env.assert(scope,
                  env.shared.isArrayLike + '(' + value + ')&&' +
                  value + '.length===4',
                  'invalid color.mask')
              })
              return loop(4, function (i) {
                return '!!' + value + '[' + i + ']'
              })
            })

        case S_SAMPLE_COVERAGE:
          return parseParam(
            function (value) {
              check$1.command(typeof value === 'object' && value, param, env.commandStr)
              var sampleValue = 'value' in value ? value.value : 1
              var sampleInvert = !!value.invert
              check$1.command(
                typeof sampleValue === 'number' &&
                sampleValue >= 0 && sampleValue <= 1,
                'sample.coverage.value must be a number between 0 and 1', env.commandStr)
              return [sampleValue, sampleInvert]
            },
            function (env, scope, value) {
              check$1.optional(function () {
                env.assert(scope,
                  value + '&&typeof ' + value + '==="object"',
                  'invalid sample.coverage')
              })
              var VALUE = scope.def(
                '"value" in ', value, '?+', value, '.value:1')
              var INVERT = scope.def('!!', value, '.invert')
              return [VALUE, INVERT]
            })
      }
    })

    return STATE
  }

  function parseUniforms (uniforms, env) {
    var staticUniforms = uniforms.static
    var dynamicUniforms = uniforms.dynamic

    var UNIFORMS = {}

    sortedObjectKeys(staticUniforms).forEach(function (name) {
      var value = staticUniforms[name]
      var result
      if (typeof value === 'number' ||
          typeof value === 'boolean') {
        result = createStaticDecl(function () {
          return value
        })
      } else if (typeof value === 'function') {
        var reglType = value._reglType
        if (reglType === 'texture2d' ||
            reglType === 'textureCube') {
          result = createStaticDecl(function (env) {
            return env.link(value)
          })
        } else if (reglType === 'framebuffer' ||
                   reglType === 'framebufferCube') {
          check$1.command(value.color.length > 0,
            'missing color attachment for framebuffer sent to uniform "' + name + '"', env.commandStr)
          result = createStaticDecl(function (env) {
            return env.link(value.color[0])
          })
        } else {
          check$1.commandRaise('invalid data for uniform "' + name + '"', env.commandStr)
        }
      } else if (isArrayLike(value)) {
        result = createStaticDecl(function (env) {
          var ITEM = env.global.def('[',
            loop(value.length, function (i) {
              check$1.command(
                typeof value[i] === 'number' ||
                typeof value[i] === 'boolean',
                'invalid uniform ' + name, env.commandStr)
              return value[i]
            }), ']')
          return ITEM
        })
      } else {
        check$1.commandRaise('invalid or missing data for uniform "' + name + '"', env.commandStr)
      }
      result.value = value
      UNIFORMS[name] = result
    })

    sortedObjectKeys(dynamicUniforms).forEach(function (key) {
      var dyn = dynamicUniforms[key]
      UNIFORMS[key] = createDynamicDecl(dyn, function (env, scope) {
        return env.invoke(scope, dyn)
      })
    })

    return UNIFORMS
  }

  function parseAttributes (attributes, env) {
    var staticAttributes = attributes.static
    var dynamicAttributes = attributes.dynamic

    var attributeDefs = {}

    sortedObjectKeys(staticAttributes).forEach(function (attribute) {
      var value = staticAttributes[attribute]
      var id = stringStore.id(attribute)

      var record = new AttributeRecord()
      if (isBufferArgs(value)) {
        record.state = ATTRIB_STATE_POINTER
        record.buffer = bufferState.getBuffer(
          bufferState.create(value, GL_ARRAY_BUFFER$2, false, true))
        record.type = 0
      } else {
        var buffer = bufferState.getBuffer(value)
        if (buffer) {
          record.state = ATTRIB_STATE_POINTER
          record.buffer = buffer
          record.type = 0
        } else {
          check$1.command(typeof value === 'object' && value,
            'invalid data for attribute ' + attribute, env.commandStr)
          if ('constant' in value) {
            var constant = value.constant
            record.buffer = 'null'
            record.state = ATTRIB_STATE_CONSTANT
            if (typeof constant === 'number') {
              record.x = constant
            } else {
              check$1.command(
                isArrayLike(constant) &&
                constant.length > 0 &&
                constant.length <= 4,
                'invalid constant for attribute ' + attribute, env.commandStr)
              CUTE_COMPONENTS.forEach(function (c, i) {
                if (i < constant.length) {
                  record[c] = constant[i]
                }
              })
            }
          } else {
            if (isBufferArgs(value.buffer)) {
              buffer = bufferState.getBuffer(
                bufferState.create(value.buffer, GL_ARRAY_BUFFER$2, false, true))
            } else {
              buffer = bufferState.getBuffer(value.buffer)
            }
            check$1.command(!!buffer, 'missing buffer for attribute "' + attribute + '"', env.commandStr)

            var offset = value.offset | 0
            check$1.command(offset >= 0,
              'invalid offset for attribute "' + attribute + '"', env.commandStr)

            var stride = value.stride | 0
            check$1.command(stride >= 0 && stride < 256,
              'invalid stride for attribute "' + attribute + '", must be integer betweeen [0, 255]', env.commandStr)

            var size = value.size | 0
            check$1.command(!('size' in value) || (size > 0 && size <= 4),
              'invalid size for attribute "' + attribute + '", must be 1,2,3,4', env.commandStr)

            var normalized = !!value.normalized

            var type = 0
            if ('type' in value) {
              check$1.commandParameter(
                value.type, glTypes,
                'invalid type for attribute ' + attribute, env.commandStr)
              type = glTypes[value.type]
            }

            var divisor = value.divisor | 0
            check$1.optional(function () {
              if ('divisor' in value) {
                check$1.command(divisor === 0 || extInstancing,
                  'cannot specify divisor for attribute "' + attribute + '", instancing not supported', env.commandStr)
                check$1.command(divisor >= 0,
                  'invalid divisor for attribute "' + attribute + '"', env.commandStr)
              }

              var command = env.commandStr

              var VALID_KEYS = [
                'buffer',
                'offset',
                'divisor',
                'normalized',
                'type',
                'size',
                'stride'
              ]

              sortedObjectKeys(value).forEach(function (prop) {
                check$1.command(
                  VALID_KEYS.indexOf(prop) >= 0,
                  'unknown parameter "' + prop + '" for attribute pointer "' + attribute + '" (valid parameters are ' + VALID_KEYS + ')',
                  command)
              })
            })

            record.buffer = buffer
            record.state = ATTRIB_STATE_POINTER
            record.size = size
            record.normalized = normalized
            record.type = type || buffer.dtype
            record.offset = offset
            record.stride = stride
            record.divisor = divisor
          }
        }
      }

      attributeDefs[attribute] = createStaticDecl(function (env, scope) {
        var cache = env.attribCache
        if (id in cache) {
          return cache[id]
        }
        var result = {
          isStream: false
        }
        sortedObjectKeys(record).forEach(function (key) {
          result[key] = record[key]
        })
        if (record.buffer) {
          result.buffer = env.link(record.buffer)
          result.type = result.type || (result.buffer + '.dtype')
        }
        cache[id] = result
        return result
      })
    })

    sortedObjectKeys(dynamicAttributes).forEach(function (attribute) {
      var dyn = dynamicAttributes[attribute]

      function appendAttributeCode (env, block) {
        var VALUE = env.invoke(block, dyn)

        var shared = env.shared
        var constants = env.constants

        var IS_BUFFER_ARGS = shared.isBufferArgs
        var BUFFER_STATE = shared.buffer

        // Perform validation on attribute
        check$1.optional(function () {
          env.assert(block,
            VALUE + '&&(typeof ' + VALUE + '==="object"||typeof ' +
            VALUE + '==="function")&&(' +
            IS_BUFFER_ARGS + '(' + VALUE + ')||' +
            BUFFER_STATE + '.getBuffer(' + VALUE + ')||' +
            BUFFER_STATE + '.getBuffer(' + VALUE + '.buffer)||' +
            IS_BUFFER_ARGS + '(' + VALUE + '.buffer)||' +
            '("constant" in ' + VALUE +
            '&&(typeof ' + VALUE + '.constant==="number"||' +
            shared.isArrayLike + '(' + VALUE + '.constant))))',
            'invalid dynamic attribute "' + attribute + '"')
        })

        // allocate names for result
        var result = {
          isStream: block.def(false)
        }
        var defaultRecord = new AttributeRecord()
        defaultRecord.state = ATTRIB_STATE_POINTER
        sortedObjectKeys(defaultRecord).forEach(function (key) {
          result[key] = block.def('' + defaultRecord[key])
        })

        var BUFFER = result.buffer
        var TYPE = result.type
        block(
          'if(', IS_BUFFER_ARGS, '(', VALUE, ')){',
          result.isStream, '=true;',
          BUFFER, '=', BUFFER_STATE, '.createStream(', GL_ARRAY_BUFFER$2, ',', VALUE, ');',
          TYPE, '=', BUFFER, '.dtype;',
          '}else{',
          BUFFER, '=', BUFFER_STATE, '.getBuffer(', VALUE, ');',
          'if(', BUFFER, '){',
          TYPE, '=', BUFFER, '.dtype;',
          '}else if("constant" in ', VALUE, '){',
          result.state, '=', ATTRIB_STATE_CONSTANT, ';',
          'if(typeof ' + VALUE + '.constant === "number"){',
          result[CUTE_COMPONENTS[0]], '=', VALUE, '.constant;',
          CUTE_COMPONENTS.slice(1).map(function (n) {
            return result[n]
          }).join('='), '=0;',
          '}else{',
          CUTE_COMPONENTS.map(function (name, i) {
            return (
              result[name] + '=' + VALUE + '.constant.length>' + i +
              '?' + VALUE + '.constant[' + i + ']:0;'
            )
          }).join(''),
          '}}else{',
          'if(', IS_BUFFER_ARGS, '(', VALUE, '.buffer)){',
          BUFFER, '=', BUFFER_STATE, '.createStream(', GL_ARRAY_BUFFER$2, ',', VALUE, '.buffer);',
          '}else{',
          BUFFER, '=', BUFFER_STATE, '.getBuffer(', VALUE, '.buffer);',
          '}',
          TYPE, '="type" in ', VALUE, '?',
          constants.glTypes, '[', VALUE, '.type]:', BUFFER, '.dtype;',
          result.normalized, '=!!', VALUE, '.normalized;')
        function emitReadRecord (name) {
          block(result[name], '=', VALUE, '.', name, '|0;')
        }
        emitReadRecord('size')
        emitReadRecord('offset')
        emitReadRecord('stride')
        emitReadRecord('divisor')

        block('}}')

        block.exit(
          'if(', result.isStream, '){',
          BUFFER_STATE, '.destroyStream(', BUFFER, ');',
          '}')

        return result
      }

      attributeDefs[attribute] = createDynamicDecl(dyn, appendAttributeCode)
    })

    return attributeDefs
  }

  function parseContext (context) {
    var staticContext = context.static
    var dynamicContext = context.dynamic
    var result = {}

    sortedObjectKeys(staticContext).forEach(function (name) {
      var value = staticContext[name]
      result[name] = createStaticDecl(function (env, scope) {
        if (typeof value === 'number' || typeof value === 'boolean') {
          return '' + value
        } else {
          return env.link(value)
        }
      })
    })

    sortedObjectKeys(dynamicContext).forEach(function (name) {
      var dyn = dynamicContext[name]
      result[name] = createDynamicDecl(dyn, function (env, scope) {
        return env.invoke(scope, dyn)
      })
    })

    return result
  }

  function parseArguments (options, attributes, uniforms, context, env) {
    var staticOptions = options.static
    var dynamicOptions = options.dynamic

    check$1.optional(function () {
      var KEY_NAMES = [
        S_FRAMEBUFFER,
        S_VERT,
        S_FRAG,
        S_ELEMENTS,
        S_PRIMITIVE,
        S_OFFSET,
        S_COUNT,
        S_INSTANCES,
        S_PROFILE,
        S_VAO
      ].concat(GL_STATE_NAMES)

      function checkKeys (dict) {
        sortedObjectKeys(dict).forEach(function (key) {
          check$1.command(
            KEY_NAMES.indexOf(key) >= 0,
            'unknown parameter "' + key + '"',
            env.commandStr)
        })
      }

      checkKeys(staticOptions)
      checkKeys(dynamicOptions)
    })

    var attribLocations = parseAttribLocations(options, attributes)

    var framebuffer = parseFramebuffer(options, env)
    var viewportAndScissor = parseViewportScissor(options, framebuffer, env)
    var draw = parseDraw(options, env)
    var state = parseGLState(options, env)
    var shader = parseProgram(options, env, attribLocations)

    function copyBox (name) {
      var defn = viewportAndScissor[name]
      if (defn) {
        state[name] = defn
      }
    }
    copyBox(S_VIEWPORT)
    copyBox(propName(S_SCISSOR_BOX))

    var dirty = sortedObjectKeys(state).length > 0

    var result = {
      framebuffer: framebuffer,
      draw: draw,
      shader: shader,
      state: state,
      dirty: dirty,
      scopeVAO: null,
      drawVAO: null,
      useVAO: false,
      attributes: {}
    }

    result.profile = parseProfile(options, env)
    result.uniforms = parseUniforms(uniforms, env)
    result.drawVAO = result.scopeVAO = draw.vao
    // special case: check if we can statically allocate a vertex array object for this program
    if (!result.drawVAO &&
      shader.program &&
      !attribLocations &&
      extensions.angle_instanced_arrays &&
      draw.static.elements) {
      var useVAO = true
      var staticBindings = shader.program.attributes.map(function (attr) {
        var binding = attributes.static[attr]
        useVAO = useVAO && !!binding
        return binding
      })
      if (useVAO && staticBindings.length > 0) {
        var vao = attributeState.getVAO(attributeState.createVAO({
          attributes: staticBindings,
          elements: draw.static.elements
        }))
        result.drawVAO = new Declaration(null, null, null, function (env, scope) {
          return env.link(vao)
        })
        result.useVAO = true
      }
    }
    if (attribLocations) {
      result.useVAO = true
    } else {
      result.attributes = parseAttributes(attributes, env)
    }
    result.context = parseContext(context, env)
    return result
  }

  // ===================================================
  // ===================================================
  // COMMON UPDATE FUNCTIONS
  // ===================================================
  // ===================================================
  function emitContext (env, scope, context) {
    var shared = env.shared
    var CONTEXT = shared.context

    var contextEnter = env.scope()

    sortedObjectKeys(context).forEach(function (name) {
      scope.save(CONTEXT, '.' + name)
      var defn = context[name]
      var value = defn.append(env, scope)
      if (Array.isArray(value)) {
        contextEnter(CONTEXT, '.', name, '=[', value.join(), '];')
      } else {
        contextEnter(CONTEXT, '.', name, '=', value, ';')
      }
    })

    scope(contextEnter)
  }

  // ===================================================
  // ===================================================
  // COMMON DRAWING FUNCTIONS
  // ===================================================
  // ===================================================
  function emitPollFramebuffer (env, scope, framebuffer, skipCheck) {
    var shared = env.shared

    var GL = shared.gl
    var FRAMEBUFFER_STATE = shared.framebuffer
    var EXT_DRAW_BUFFERS
    if (extDrawBuffers) {
      EXT_DRAW_BUFFERS = scope.def(shared.extensions, '.webgl_draw_buffers')
    }

    var constants = env.constants

    var DRAW_BUFFERS = constants.drawBuffer
    var BACK_BUFFER = constants.backBuffer

    var NEXT
    if (framebuffer) {
      NEXT = framebuffer.append(env, scope)
    } else {
      NEXT = scope.def(FRAMEBUFFER_STATE, '.next')
    }

    if (!skipCheck) {
      scope('if(', NEXT, '!==', FRAMEBUFFER_STATE, '.cur){')
    }
    scope(
      'if(', NEXT, '){',
      GL, '.bindFramebuffer(', GL_FRAMEBUFFER$2, ',', NEXT, '.framebuffer);')
    if (extDrawBuffers) {
      scope(EXT_DRAW_BUFFERS, '.drawBuffersWEBGL(',
        DRAW_BUFFERS, '[', NEXT, '.colorAttachments.length]);')
    }
    scope('}else{',
      GL, '.bindFramebuffer(', GL_FRAMEBUFFER$2, ',null);')
    if (extDrawBuffers) {
      scope(EXT_DRAW_BUFFERS, '.drawBuffersWEBGL(', BACK_BUFFER, ');')
    }
    scope(
      '}',
      FRAMEBUFFER_STATE, '.cur=', NEXT, ';')
    if (!skipCheck) {
      scope('}')
    }
  }

  function emitPollState (env, scope, args) {
    var shared = env.shared

    var GL = shared.gl

    var CURRENT_VARS = env.current
    var NEXT_VARS = env.next
    var CURRENT_STATE = shared.current
    var NEXT_STATE = shared.next

    var block = env.cond(CURRENT_STATE, '.dirty')

    GL_STATE_NAMES.forEach(function (prop) {
      var param = propName(prop)
      if (param in args.state) {
        return
      }

      var NEXT, CURRENT
      if (param in NEXT_VARS) {
        NEXT = NEXT_VARS[param]
        CURRENT = CURRENT_VARS[param]
        var parts = loop(currentState[param].length, function (i) {
          return block.def(NEXT, '[', i, ']')
        })
        block(env.cond(parts.map(function (p, i) {
          return p + '!==' + CURRENT + '[' + i + ']'
        }).join('||'))
          .then(
            GL, '.', GL_VARIABLES[param], '(', parts, ');',
            parts.map(function (p, i) {
              return CURRENT + '[' + i + ']=' + p
            }).join(';'), ';'))
      } else {
        NEXT = block.def(NEXT_STATE, '.', param)
        var ifte = env.cond(NEXT, '!==', CURRENT_STATE, '.', param)
        block(ifte)
        if (param in GL_FLAGS) {
          ifte(
            env.cond(NEXT)
              .then(GL, '.enable(', GL_FLAGS[param], ');')
              .else(GL, '.disable(', GL_FLAGS[param], ');'),
            CURRENT_STATE, '.', param, '=', NEXT, ';')
        } else {
          ifte(
            GL, '.', GL_VARIABLES[param], '(', NEXT, ');',
            CURRENT_STATE, '.', param, '=', NEXT, ';')
        }
      }
    })
    if (sortedObjectKeys(args.state).length === 0) {
      block(CURRENT_STATE, '.dirty=false;')
    }
    scope(block)
  }

  function emitSetOptions (env, scope, options, filter) {
    var shared = env.shared
    var CURRENT_VARS = env.current
    var CURRENT_STATE = shared.current
    var GL = shared.gl
    sortState(sortedObjectKeys(options)).forEach(function (param) {
      var defn = options[param]
      if (filter && !filter(defn)) {
        return
      }
      var variable = defn.append(env, scope)
      if (GL_FLAGS[param]) {
        var flag = GL_FLAGS[param]
        if (isStatic(defn)) {
          if (variable) {
            scope(GL, '.enable(', flag, ');')
          } else {
            scope(GL, '.disable(', flag, ');')
          }
        } else {
          scope(env.cond(variable)
            .then(GL, '.enable(', flag, ');')
            .else(GL, '.disable(', flag, ');'))
        }
        scope(CURRENT_STATE, '.', param, '=', variable, ';')
      } else if (isArrayLike(variable)) {
        var CURRENT = CURRENT_VARS[param]
        scope(
          GL, '.', GL_VARIABLES[param], '(', variable, ');',
          variable.map(function (v, i) {
            return CURRENT + '[' + i + ']=' + v
          }).join(';'), ';')
      } else {
        scope(
          GL, '.', GL_VARIABLES[param], '(', variable, ');',
          CURRENT_STATE, '.', param, '=', variable, ';')
      }
    })
  }

  function injectExtensions (env, scope) {
    if (extInstancing) {
      env.instancing = scope.def(
        env.shared.extensions, '.angle_instanced_arrays')
    }
  }

  function emitProfile (env, scope, args, useScope, incrementCounter) {
    var shared = env.shared
    var STATS = env.stats
    var CURRENT_STATE = shared.current
    var TIMER = shared.timer
    var profileArg = args.profile

    function perfCounter () {
      if (typeof performance === 'undefined') {
        return 'Date.now()'
      } else {
        return 'performance.now()'
      }
    }

    var CPU_START, QUERY_COUNTER
    function emitProfileStart (block) {
      CPU_START = scope.def()
      block(CPU_START, '=', perfCounter(), ';')
      if (typeof incrementCounter === 'string') {
        block(STATS, '.count+=', incrementCounter, ';')
      } else {
        block(STATS, '.count++;')
      }
      if (timer) {
        if (useScope) {
          QUERY_COUNTER = scope.def()
          block(QUERY_COUNTER, '=', TIMER, '.getNumPendingQueries();')
        } else {
          block(TIMER, '.beginQuery(', STATS, ');')
        }
      }
    }

    function emitProfileEnd (block) {
      block(STATS, '.cpuTime+=', perfCounter(), '-', CPU_START, ';')
      if (timer) {
        if (useScope) {
          block(TIMER, '.pushScopeStats(',
            QUERY_COUNTER, ',',
            TIMER, '.getNumPendingQueries(),',
            STATS, ');')
        } else {
          block(TIMER, '.endQuery();')
        }
      }
    }

    function scopeProfile (value) {
      var prev = scope.def(CURRENT_STATE, '.profile')
      scope(CURRENT_STATE, '.profile=', value, ';')
      scope.exit(CURRENT_STATE, '.profile=', prev, ';')
    }

    var USE_PROFILE
    if (profileArg) {
      if (isStatic(profileArg)) {
        if (profileArg.enable) {
          emitProfileStart(scope)
          emitProfileEnd(scope.exit)
          scopeProfile('true')
        } else {
          scopeProfile('false')
        }
        return
      }
      USE_PROFILE = profileArg.append(env, scope)
      scopeProfile(USE_PROFILE)
    } else {
      USE_PROFILE = scope.def(CURRENT_STATE, '.profile')
    }

    var start = env.block()
    emitProfileStart(start)
    scope('if(', USE_PROFILE, '){', start, '}')
    var end = env.block()
    emitProfileEnd(end)
    scope.exit('if(', USE_PROFILE, '){', end, '}')
  }

  function emitAttributes (env, scope, args, attributes, filter) {
    var shared = env.shared

    function typeLength (x) {
      switch (x) {
        case GL_FLOAT_VEC2:
        case GL_INT_VEC2:
        case GL_BOOL_VEC2:
          return 2
        case GL_FLOAT_VEC3:
        case GL_INT_VEC3:
        case GL_BOOL_VEC3:
          return 3
        case GL_FLOAT_VEC4:
        case GL_INT_VEC4:
        case GL_BOOL_VEC4:
          return 4
        default:
          return 1
      }
    }

    function emitBindAttribute (ATTRIBUTE, size, record) {
      var GL = shared.gl

      var LOCATION = scope.def(ATTRIBUTE, '.location')
      var BINDING = scope.def(shared.attributes, '[', LOCATION, ']')

      var STATE = record.state
      var BUFFER = record.buffer
      var CONST_COMPONENTS = [
        record.x,
        record.y,
        record.z,
        record.w
      ]

      var COMMON_KEYS = [
        'buffer',
        'normalized',
        'offset',
        'stride'
      ]

      function emitBuffer () {
        scope(
          'if(!', BINDING, '.buffer){',
          GL, '.enableVertexAttribArray(', LOCATION, ');}')

        var TYPE = record.type
        var SIZE
        if (!record.size) {
          SIZE = size
        } else {
          SIZE = scope.def(record.size, '||', size)
        }

        scope('if(',
          BINDING, '.type!==', TYPE, '||',
          BINDING, '.size!==', SIZE, '||',
          COMMON_KEYS.map(function (key) {
            return BINDING + '.' + key + '!==' + record[key]
          }).join('||'),
          '){',
          GL, '.bindBuffer(', GL_ARRAY_BUFFER$2, ',', BUFFER, '.buffer);',
          GL, '.vertexAttribPointer(', [
            LOCATION,
            SIZE,
            TYPE,
            record.normalized,
            record.stride,
            record.offset
          ], ');',
          BINDING, '.type=', TYPE, ';',
          BINDING, '.size=', SIZE, ';',
          COMMON_KEYS.map(function (key) {
            return BINDING + '.' + key + '=' + record[key] + ';'
          }).join(''),
          '}')

        if (extInstancing) {
          var DIVISOR = record.divisor
          scope(
            'if(', BINDING, '.divisor!==', DIVISOR, '){',
            env.instancing, '.vertexAttribDivisorANGLE(', [LOCATION, DIVISOR], ');',
            BINDING, '.divisor=', DIVISOR, ';}')
        }
      }

      function emitConstant () {
        scope(
          'if(', BINDING, '.buffer){',
          GL, '.disableVertexAttribArray(', LOCATION, ');',
          BINDING, '.buffer=null;',
          '}if(', CUTE_COMPONENTS.map(function (c, i) {
            return BINDING + '.' + c + '!==' + CONST_COMPONENTS[i]
          }).join('||'), '){',
          GL, '.vertexAttrib4f(', LOCATION, ',', CONST_COMPONENTS, ');',
          CUTE_COMPONENTS.map(function (c, i) {
            return BINDING + '.' + c + '=' + CONST_COMPONENTS[i] + ';'
          }).join(''),
          '}')
      }

      if (STATE === ATTRIB_STATE_POINTER) {
        emitBuffer()
      } else if (STATE === ATTRIB_STATE_CONSTANT) {
        emitConstant()
      } else {
        scope('if(', STATE, '===', ATTRIB_STATE_POINTER, '){')
        emitBuffer()
        scope('}else{')
        emitConstant()
        scope('}')
      }
    }

    attributes.forEach(function (attribute) {
      var name = attribute.name
      var arg = args.attributes[name]
      var record
      if (arg) {
        if (!filter(arg)) {
          return
        }
        record = arg.append(env, scope)
      } else {
        if (!filter(SCOPE_DECL)) {
          return
        }
        var scopeAttrib = env.scopeAttrib(name)
        check$1.optional(function () {
          env.assert(scope,
            scopeAttrib + '.state',
            'missing attribute ' + name)
        })
        record = {}
        sortedObjectKeys(new AttributeRecord()).forEach(function (key) {
          record[key] = scope.def(scopeAttrib, '.', key)
        })
      }
      emitBindAttribute(
        env.link(attribute), typeLength(attribute.info.type), record)
    })
  }

  function emitUniforms (env, scope, args, uniforms, filter, isBatchInnerLoop) {
    var shared = env.shared
    var GL = shared.gl

    var infix
    for (var i = 0; i < uniforms.length; ++i) {
      var uniform = uniforms[i]
      var name = uniform.name
      var type = uniform.info.type
      var arg = args.uniforms[name]
      var UNIFORM = env.link(uniform)
      var LOCATION = UNIFORM + '.location'

      var VALUE
      if (arg) {
        if (!filter(arg)) {
          continue
        }
        if (isStatic(arg)) {
          var value = arg.value
          check$1.command(
            value !== null && typeof value !== 'undefined',
            'missing uniform "' + name + '"', env.commandStr)
          if (type === GL_SAMPLER_2D || type === GL_SAMPLER_CUBE) {
            check$1.command(
              typeof value === 'function' &&
              ((type === GL_SAMPLER_2D &&
                (value._reglType === 'texture2d' ||
                value._reglType === 'framebuffer')) ||
              (type === GL_SAMPLER_CUBE &&
                (value._reglType === 'textureCube' ||
                value._reglType === 'framebufferCube'))),
              'invalid texture for uniform ' + name, env.commandStr)
            var TEX_VALUE = env.link(value._texture || value.color[0]._texture)
            scope(GL, '.uniform1i(', LOCATION, ',', TEX_VALUE + '.bind());')
            scope.exit(TEX_VALUE, '.unbind();')
          } else if (
            type === GL_FLOAT_MAT2 ||
            type === GL_FLOAT_MAT3 ||
            type === GL_FLOAT_MAT4) {
            check$1.optional(function () {
              check$1.command(isArrayLike(value),
                'invalid matrix for uniform ' + name, env.commandStr)
              check$1.command(
                (type === GL_FLOAT_MAT2 && value.length === 4) ||
                (type === GL_FLOAT_MAT3 && value.length === 9) ||
                (type === GL_FLOAT_MAT4 && value.length === 16),
                'invalid length for matrix uniform ' + name, env.commandStr)
            })
            var MAT_VALUE = env.global.def('new Float32Array([' +
              Array.prototype.slice.call(value) + '])')
            var dim = 2
            if (type === GL_FLOAT_MAT3) {
              dim = 3
            } else if (type === GL_FLOAT_MAT4) {
              dim = 4
            }
            scope(
              GL, '.uniformMatrix', dim, 'fv(',
              LOCATION, ',false,', MAT_VALUE, ');')
          } else {
            switch (type) {
              case GL_FLOAT$8:
                check$1.commandType(value, 'number', 'uniform ' + name, env.commandStr)
                infix = '1f'
                break
              case GL_FLOAT_VEC2:
                check$1.command(
                  isArrayLike(value) && value.length === 2,
                  'uniform ' + name, env.commandStr)
                infix = '2f'
                break
              case GL_FLOAT_VEC3:
                check$1.command(
                  isArrayLike(value) && value.length === 3,
                  'uniform ' + name, env.commandStr)
                infix = '3f'
                break
              case GL_FLOAT_VEC4:
                check$1.command(
                  isArrayLike(value) && value.length === 4,
                  'uniform ' + name, env.commandStr)
                infix = '4f'
                break
              case GL_BOOL:
                check$1.commandType(value, 'boolean', 'uniform ' + name, env.commandStr)
                infix = '1i'
                break
              case GL_INT$3:
                check$1.commandType(value, 'number', 'uniform ' + name, env.commandStr)
                infix = '1i'
                break
              case GL_BOOL_VEC2:
                check$1.command(
                  isArrayLike(value) && value.length === 2,
                  'uniform ' + name, env.commandStr)
                infix = '2i'
                break
              case GL_INT_VEC2:
                check$1.command(
                  isArrayLike(value) && value.length === 2,
                  'uniform ' + name, env.commandStr)
                infix = '2i'
                break
              case GL_BOOL_VEC3:
                check$1.command(
                  isArrayLike(value) && value.length === 3,
                  'uniform ' + name, env.commandStr)
                infix = '3i'
                break
              case GL_INT_VEC3:
                check$1.command(
                  isArrayLike(value) && value.length === 3,
                  'uniform ' + name, env.commandStr)
                infix = '3i'
                break
              case GL_BOOL_VEC4:
                check$1.command(
                  isArrayLike(value) && value.length === 4,
                  'uniform ' + name, env.commandStr)
                infix = '4i'
                break
              case GL_INT_VEC4:
                check$1.command(
                  isArrayLike(value) && value.length === 4,
                  'uniform ' + name, env.commandStr)
                infix = '4i'
                break
            }
            scope(GL, '.uniform', infix, '(', LOCATION, ',',
              isArrayLike(value) ? Array.prototype.slice.call(value) : value,
              ');')
          }
          continue
        } else {
          VALUE = arg.append(env, scope)
        }
      } else {
        if (!filter(SCOPE_DECL)) {
          continue
        }
        VALUE = scope.def(shared.uniforms, '[', stringStore.id(name), ']')
      }

      if (type === GL_SAMPLER_2D) {
        check$1(!Array.isArray(VALUE), 'must specify a scalar prop for textures')
        scope(
          'if(', VALUE, '&&', VALUE, '._reglType==="framebuffer"){',
          VALUE, '=', VALUE, '.color[0];',
          '}')
      } else if (type === GL_SAMPLER_CUBE) {
        check$1(!Array.isArray(VALUE), 'must specify a scalar prop for cube maps')
        scope(
          'if(', VALUE, '&&', VALUE, '._reglType==="framebufferCube"){',
          VALUE, '=', VALUE, '.color[0];',
          '}')
      }

      // perform type validation
      check$1.optional(function () {
        function emitCheck (pred, message) {
          env.assert(scope, pred,
            'bad data or missing for uniform "' + name + '".  ' + message)
        }

        function checkType (type) {
          check$1(!Array.isArray(VALUE), 'must not specify an array type for uniform')
          emitCheck(
            'typeof ' + VALUE + '==="' + type + '"',
            'invalid type, expected ' + type)
        }

        function checkVector (n, type) {
          if (Array.isArray(VALUE)) {
            check$1(VALUE.length === n, 'must have length ' + n)
          } else {
            emitCheck(
              shared.isArrayLike + '(' + VALUE + ')&&' + VALUE + '.length===' + n,
              'invalid vector, should have length ' + n, env.commandStr)
          }
        }

        function checkTexture (target) {
          check$1(!Array.isArray(VALUE), 'must not specify a value type')
          emitCheck(
            'typeof ' + VALUE + '==="function"&&' +
            VALUE + '._reglType==="texture' +
            (target === GL_TEXTURE_2D$3 ? '2d' : 'Cube') + '"',
            'invalid texture type', env.commandStr)
        }

        switch (type) {
          case GL_INT$3:
            checkType('number')
            break
          case GL_INT_VEC2:
            checkVector(2, 'number')
            break
          case GL_INT_VEC3:
            checkVector(3, 'number')
            break
          case GL_INT_VEC4:
            checkVector(4, 'number')
            break
          case GL_FLOAT$8:
            checkType('number')
            break
          case GL_FLOAT_VEC2:
            checkVector(2, 'number')
            break
          case GL_FLOAT_VEC3:
            checkVector(3, 'number')
            break
          case GL_FLOAT_VEC4:
            checkVector(4, 'number')
            break
          case GL_BOOL:
            checkType('boolean')
            break
          case GL_BOOL_VEC2:
            checkVector(2, 'boolean')
            break
          case GL_BOOL_VEC3:
            checkVector(3, 'boolean')
            break
          case GL_BOOL_VEC4:
            checkVector(4, 'boolean')
            break
          case GL_FLOAT_MAT2:
            checkVector(4, 'number')
            break
          case GL_FLOAT_MAT3:
            checkVector(9, 'number')
            break
          case GL_FLOAT_MAT4:
            checkVector(16, 'number')
            break
          case GL_SAMPLER_2D:
            checkTexture(GL_TEXTURE_2D$3)
            break
          case GL_SAMPLER_CUBE:
            checkTexture(GL_TEXTURE_CUBE_MAP$2)
            break
        }
      })

      var unroll = 1
      switch (type) {
        case GL_SAMPLER_2D:
        case GL_SAMPLER_CUBE:
          var TEX = scope.def(VALUE, '._texture')
          scope(GL, '.uniform1i(', LOCATION, ',', TEX, '.bind());')
          scope.exit(TEX, '.unbind();')
          continue

        case GL_INT$3:
        case GL_BOOL:
          infix = '1i'
          break

        case GL_INT_VEC2:
        case GL_BOOL_VEC2:
          infix = '2i'
          unroll = 2
          break

        case GL_INT_VEC3:
        case GL_BOOL_VEC3:
          infix = '3i'
          unroll = 3
          break

        case GL_INT_VEC4:
        case GL_BOOL_VEC4:
          infix = '4i'
          unroll = 4
          break

        case GL_FLOAT$8:
          infix = '1f'
          break

        case GL_FLOAT_VEC2:
          infix = '2f'
          unroll = 2
          break

        case GL_FLOAT_VEC3:
          infix = '3f'
          unroll = 3
          break

        case GL_FLOAT_VEC4:
          infix = '4f'
          unroll = 4
          break

        case GL_FLOAT_MAT2:
          infix = 'Matrix2fv'
          break

        case GL_FLOAT_MAT3:
          infix = 'Matrix3fv'
          break

        case GL_FLOAT_MAT4:
          infix = 'Matrix4fv'
          break
      }

      if (infix.charAt(0) === 'M') {
        scope(GL, '.uniform', infix, '(', LOCATION, ',')
        var matSize = Math.pow(type - GL_FLOAT_MAT2 + 2, 2)
        var STORAGE = env.global.def('new Float32Array(', matSize, ')')
        if (Array.isArray(VALUE)) {
          scope(
            'false,(',
            loop(matSize, function (i) {
              return STORAGE + '[' + i + ']=' + VALUE[i]
            }), ',', STORAGE, ')')
        } else {
          scope(
            'false,(Array.isArray(', VALUE, ')||', VALUE, ' instanceof Float32Array)?', VALUE, ':(',
            loop(matSize, function (i) {
              return STORAGE + '[' + i + ']=' + VALUE + '[' + i + ']'
            }), ',', STORAGE, ')')
        }
        scope(');')
      } else if (unroll > 1) {
        var prev = []
        var cur = []
        for (var j = 0; j < unroll; ++j) {
          if (Array.isArray(VALUE)) {
            cur.push(VALUE[j])
          } else {
            cur.push(scope.def(VALUE + '[' + j + ']'))
          }
          if (isBatchInnerLoop) {
            prev.push(scope.def())
          }
        }
        if (isBatchInnerLoop) {
          scope('if(!', env.batchId, '||', prev.map(function (p, i) {
            return p + '!==' + cur[i]
          }).join('||'), '){', prev.map(function (p, i) {
            return p + '=' + cur[i] + ';'
          }).join(''))
        }
        scope(GL, '.uniform', infix, '(', LOCATION, ',', cur.join(','), ');')
        if (isBatchInnerLoop) {
          scope('}')
        }
      } else {
        check$1(!Array.isArray(VALUE), 'uniform value must not be an array')
        if (isBatchInnerLoop) {
          var prevS = scope.def()
          scope('if(!', env.batchId, '||', prevS, '!==', VALUE, '){',
            prevS, '=', VALUE, ';')
        }
        scope(GL, '.uniform', infix, '(', LOCATION, ',', VALUE, ');')
        if (isBatchInnerLoop) {
          scope('}')
        }
      }
    }
  }

  function emitDraw (env, outer, inner, args) {
    var shared = env.shared
    var GL = shared.gl
    var DRAW_STATE = shared.draw

    var drawOptions = args.draw

    function emitElements () {
      var defn = drawOptions.elements
      var ELEMENTS
      var scope = outer
      if (defn) {
        if ((defn.contextDep && args.contextDynamic) || defn.propDep) {
          scope = inner
        }
        ELEMENTS = defn.append(env, scope)
        if (drawOptions.elementsActive) {
          scope(
            'if(' + ELEMENTS + ')' +
            GL + '.bindBuffer(' + GL_ELEMENT_ARRAY_BUFFER$2 + ',' + ELEMENTS + '.buffer.buffer);')
        }
      } else {
        ELEMENTS = scope.def()
        scope(
          ELEMENTS, '=', DRAW_STATE, '.', S_ELEMENTS, ';',
          'if(', ELEMENTS, '){',
          GL, '.bindBuffer(', GL_ELEMENT_ARRAY_BUFFER$2, ',', ELEMENTS, '.buffer.buffer);}',
          'else if(', shared.vao, '.currentVAO){',
          ELEMENTS, '=', env.shared.elements + '.getElements(' + shared.vao, '.currentVAO.elements);',
          (!extVertexArrays ? 'if(' + ELEMENTS + ')' + GL + '.bindBuffer(' + GL_ELEMENT_ARRAY_BUFFER$2 + ',' + ELEMENTS + '.buffer.buffer);' : ''),
          '}')
      }
      return ELEMENTS
    }

    function emitCount () {
      var defn = drawOptions.count
      var COUNT
      var scope = outer
      if (defn) {
        if ((defn.contextDep && args.contextDynamic) || defn.propDep) {
          scope = inner
        }
        COUNT = defn.append(env, scope)
        check$1.optional(function () {
          if (defn.MISSING) {
            env.assert(outer, 'false', 'missing vertex count')
          }
          if (defn.DYNAMIC) {
            env.assert(scope, COUNT + '>=0', 'missing vertex count')
          }
        })
      } else {
        COUNT = scope.def(DRAW_STATE, '.', S_COUNT)
        check$1.optional(function () {
          env.assert(scope, COUNT + '>=0', 'missing vertex count')
        })
      }
      return COUNT
    }

    var ELEMENTS = emitElements()
    function emitValue (name) {
      var defn = drawOptions[name]
      if (defn) {
        if ((defn.contextDep && args.contextDynamic) || defn.propDep) {
          return defn.append(env, inner)
        } else {
          return defn.append(env, outer)
        }
      } else {
        return outer.def(DRAW_STATE, '.', name)
      }
    }

    var PRIMITIVE = emitValue(S_PRIMITIVE)
    var OFFSET = emitValue(S_OFFSET)

    var COUNT = emitCount()
    if (typeof COUNT === 'number') {
      if (COUNT === 0) {
        return
      }
    } else {
      inner('if(', COUNT, '){')
      inner.exit('}')
    }

    var INSTANCES, EXT_INSTANCING
    if (extInstancing) {
      INSTANCES = emitValue(S_INSTANCES)
      EXT_INSTANCING = env.instancing
    }

    var ELEMENT_TYPE = ELEMENTS + '.type'

    var elementsStatic = drawOptions.elements && isStatic(drawOptions.elements) && !drawOptions.vaoActive

    function emitInstancing () {
      function drawElements () {
        inner(EXT_INSTANCING, '.drawElementsInstancedANGLE(', [
          PRIMITIVE,
          COUNT,
          ELEMENT_TYPE,
          OFFSET + '<<((' + ELEMENT_TYPE + '-' + GL_UNSIGNED_BYTE$8 + ')>>1)',
          INSTANCES
        ], ');')
      }

      function drawArrays () {
        inner(EXT_INSTANCING, '.drawArraysInstancedANGLE(',
          [PRIMITIVE, OFFSET, COUNT, INSTANCES], ');')
      }

      if (ELEMENTS && ELEMENTS !== 'null') {
        if (!elementsStatic) {
          inner('if(', ELEMENTS, '){')
          drawElements()
          inner('}else{')
          drawArrays()
          inner('}')
        } else {
          drawElements()
        }
      } else {
        drawArrays()
      }
    }

    function emitRegular () {
      function drawElements () {
        inner(GL + '.drawElements(' + [
          PRIMITIVE,
          COUNT,
          ELEMENT_TYPE,
          OFFSET + '<<((' + ELEMENT_TYPE + '-' + GL_UNSIGNED_BYTE$8 + ')>>1)'
        ] + ');')
      }

      function drawArrays () {
        inner(GL + '.drawArrays(' + [PRIMITIVE, OFFSET, COUNT] + ');')
      }

      if (ELEMENTS && ELEMENTS !== 'null') {
        if (!elementsStatic) {
          inner('if(', ELEMENTS, '){')
          drawElements()
          inner('}else{')
          drawArrays()
          inner('}')
        } else {
          drawElements()
        }
      } else {
        drawArrays()
      }
    }

    if (extInstancing && (typeof INSTANCES !== 'number' || INSTANCES >= 0)) {
      if (typeof INSTANCES === 'string') {
        inner('if(', INSTANCES, '>0){')
        emitInstancing()
        inner('}else if(', INSTANCES, '<0){')
        emitRegular()
        inner('}')
      } else {
        emitInstancing()
      }
    } else {
      emitRegular()
    }
  }

  function createBody (emitBody, parentEnv, args, program, count) {
    var env = createREGLEnvironment()
    var scope = env.proc('body', count)
    check$1.optional(function () {
      env.commandStr = parentEnv.commandStr
      env.command = env.link(parentEnv.commandStr)
    })
    if (extInstancing) {
      env.instancing = scope.def(
        env.shared.extensions, '.angle_instanced_arrays')
    }
    emitBody(env, scope, args, program)
    return env.compile().body
  }

  // ===================================================
  // ===================================================
  // DRAW PROC
  // ===================================================
  // ===================================================
  function emitDrawBody (env, draw, args, program) {
    injectExtensions(env, draw)
    if (args.useVAO) {
      if (args.drawVAO) {
        draw(env.shared.vao, '.setVAO(', args.drawVAO.append(env, draw), ');')
      } else {
        draw(env.shared.vao, '.setVAO(', env.shared.vao, '.targetVAO);')
      }
    } else {
      draw(env.shared.vao, '.setVAO(null);')
      emitAttributes(env, draw, args, program.attributes, function () {
        return true
      })
    }
    emitUniforms(env, draw, args, program.uniforms, function () {
      return true
    }, false)
    emitDraw(env, draw, draw, args)
  }

  function emitDrawProc (env, args) {
    var draw = env.proc('draw', 1)

    injectExtensions(env, draw)

    emitContext(env, draw, args.context)
    emitPollFramebuffer(env, draw, args.framebuffer)

    emitPollState(env, draw, args)
    emitSetOptions(env, draw, args.state)

    emitProfile(env, draw, args, false, true)

    var program = args.shader.progVar.append(env, draw)
    draw(env.shared.gl, '.useProgram(', program, '.program);')

    if (args.shader.program) {
      emitDrawBody(env, draw, args, args.shader.program)
    } else {
      draw(env.shared.vao, '.setVAO(null);')
      var drawCache = env.global.def('{}')
      var PROG_ID = draw.def(program, '.id')
      var CACHED_PROC = draw.def(drawCache, '[', PROG_ID, ']')
      draw(
        env.cond(CACHED_PROC)
          .then(CACHED_PROC, '.call(this,a0);')
          .else(
            CACHED_PROC, '=', drawCache, '[', PROG_ID, ']=',
            env.link(function (program) {
              return createBody(emitDrawBody, env, args, program, 1)
            }), '(', program, ');',
            CACHED_PROC, '.call(this,a0);'))
    }

    if (sortedObjectKeys(args.state).length > 0) {
      draw(env.shared.current, '.dirty=true;')
    }
    if (env.shared.vao) {
      draw(env.shared.vao, '.setVAO(null);')
    }
  }

  // ===================================================
  // ===================================================
  // BATCH PROC
  // ===================================================
  // ===================================================

  function emitBatchDynamicShaderBody (env, scope, args, program) {
    env.batchId = 'a1'

    injectExtensions(env, scope)

    function all () {
      return true
    }

    emitAttributes(env, scope, args, program.attributes, all)
    emitUniforms(env, scope, args, program.uniforms, all, false)
    emitDraw(env, scope, scope, args)
  }

  function emitBatchBody (env, scope, args, program) {
    injectExtensions(env, scope)

    var contextDynamic = args.contextDep

    var BATCH_ID = scope.def()
    var PROP_LIST = 'a0'
    var NUM_PROPS = 'a1'
    var PROPS = scope.def()
    env.shared.props = PROPS
    env.batchId = BATCH_ID

    var outer = env.scope()
    var inner = env.scope()

    scope(
      outer.entry,
      'for(', BATCH_ID, '=0;', BATCH_ID, '<', NUM_PROPS, ';++', BATCH_ID, '){',
      PROPS, '=', PROP_LIST, '[', BATCH_ID, '];',
      inner,
      '}',
      outer.exit)

    function isInnerDefn (defn) {
      return ((defn.contextDep && contextDynamic) || defn.propDep)
    }

    function isOuterDefn (defn) {
      return !isInnerDefn(defn)
    }

    if (args.needsContext) {
      emitContext(env, inner, args.context)
    }
    if (args.needsFramebuffer) {
      emitPollFramebuffer(env, inner, args.framebuffer)
    }
    emitSetOptions(env, inner, args.state, isInnerDefn)

    if (args.profile && isInnerDefn(args.profile)) {
      emitProfile(env, inner, args, false, true)
    }

    if (!program) {
      var progCache = env.global.def('{}')
      var PROGRAM = args.shader.progVar.append(env, inner)
      var PROG_ID = inner.def(PROGRAM, '.id')
      var CACHED_PROC = inner.def(progCache, '[', PROG_ID, ']')
      inner(
        env.shared.gl, '.useProgram(', PROGRAM, '.program);',
        'if(!', CACHED_PROC, '){',
        CACHED_PROC, '=', progCache, '[', PROG_ID, ']=',
        env.link(function (program) {
          return createBody(
            emitBatchDynamicShaderBody, env, args, program, 2)
        }), '(', PROGRAM, ');}',
        CACHED_PROC, '.call(this,a0[', BATCH_ID, '],', BATCH_ID, ');')
    } else {
      if (args.useVAO) {
        if (args.drawVAO) {
          if (isInnerDefn(args.drawVAO)) {
            // vao is a prop
            inner(env.shared.vao, '.setVAO(', args.drawVAO.append(env, inner), ');')
          } else {
            // vao is invariant
            outer(env.shared.vao, '.setVAO(', args.drawVAO.append(env, outer), ');')
          }
        } else {
          // scoped vao binding
          outer(env.shared.vao, '.setVAO(', env.shared.vao, '.targetVAO);')
        }
      } else {
        outer(env.shared.vao, '.setVAO(null);')
        emitAttributes(env, outer, args, program.attributes, isOuterDefn)
        emitAttributes(env, inner, args, program.attributes, isInnerDefn)
      }
      emitUniforms(env, outer, args, program.uniforms, isOuterDefn, false)
      emitUniforms(env, inner, args, program.uniforms, isInnerDefn, true)
      emitDraw(env, outer, inner, args)
    }
  }

  function emitBatchProc (env, args) {
    var batch = env.proc('batch', 2)
    env.batchId = '0'

    injectExtensions(env, batch)

    // Check if any context variables depend on props
    var contextDynamic = false
    var needsContext = true
    sortedObjectKeys(args.context).forEach(function (name) {
      contextDynamic = contextDynamic || args.context[name].propDep
    })
    if (!contextDynamic) {
      emitContext(env, batch, args.context)
      needsContext = false
    }

    // framebuffer state affects framebufferWidth/height context vars
    var framebuffer = args.framebuffer
    var needsFramebuffer = false
    if (framebuffer) {
      if (framebuffer.propDep) {
        contextDynamic = needsFramebuffer = true
      } else if (framebuffer.contextDep && contextDynamic) {
        needsFramebuffer = true
      }
      if (!needsFramebuffer) {
        emitPollFramebuffer(env, batch, framebuffer)
      }
    } else {
      emitPollFramebuffer(env, batch, null)
    }

    // viewport is weird because it can affect context vars
    if (args.state.viewport && args.state.viewport.propDep) {
      contextDynamic = true
    }

    function isInnerDefn (defn) {
      return (defn.contextDep && contextDynamic) || defn.propDep
    }

    // set webgl options
    emitPollState(env, batch, args)
    emitSetOptions(env, batch, args.state, function (defn) {
      return !isInnerDefn(defn)
    })

    if (!args.profile || !isInnerDefn(args.profile)) {
      emitProfile(env, batch, args, false, 'a1')
    }

    // Save these values to args so that the batch body routine can use them
    args.contextDep = contextDynamic
    args.needsContext = needsContext
    args.needsFramebuffer = needsFramebuffer

    // determine if shader is dynamic
    var progDefn = args.shader.progVar
    if ((progDefn.contextDep && contextDynamic) || progDefn.propDep) {
      emitBatchBody(
        env,
        batch,
        args,
        null)
    } else {
      var PROGRAM = progDefn.append(env, batch)
      batch(env.shared.gl, '.useProgram(', PROGRAM, '.program);')
      if (args.shader.program) {
        emitBatchBody(
          env,
          batch,
          args,
          args.shader.program)
      } else {
        batch(env.shared.vao, '.setVAO(null);')
        var batchCache = env.global.def('{}')
        var PROG_ID = batch.def(PROGRAM, '.id')
        var CACHED_PROC = batch.def(batchCache, '[', PROG_ID, ']')
        batch(
          env.cond(CACHED_PROC)
            .then(CACHED_PROC, '.call(this,a0,a1);')
            .else(
              CACHED_PROC, '=', batchCache, '[', PROG_ID, ']=',
              env.link(function (program) {
                return createBody(emitBatchBody, env, args, program, 2)
              }), '(', PROGRAM, ');',
              CACHED_PROC, '.call(this,a0,a1);'))
      }
    }

    if (sortedObjectKeys(args.state).length > 0) {
      batch(env.shared.current, '.dirty=true;')
    }

    if (env.shared.vao) {
      batch(env.shared.vao, '.setVAO(null);')
    }
  }

  // ===================================================
  // ===================================================
  // SCOPE COMMAND
  // ===================================================
  // ===================================================
  function emitScopeProc (env, args) {
    var scope = env.proc('scope', 3)
    env.batchId = 'a2'

    var shared = env.shared
    var CURRENT_STATE = shared.current

    emitContext(env, scope, args.context)

    if (args.framebuffer) {
      args.framebuffer.append(env, scope)
    }

    sortState(sortedObjectKeys(args.state)).forEach(function (name) {
      var defn = args.state[name]
      var value = defn.append(env, scope)
      if (isArrayLike(value)) {
        value.forEach(function (v, i) {
          scope.set(env.next[name], '[' + i + ']', v)
        })
      } else {
        scope.set(shared.next, '.' + name, value)
      }
    })

    emitProfile(env, scope, args, true, true)

    ;[S_ELEMENTS, S_OFFSET, S_COUNT, S_INSTANCES, S_PRIMITIVE].forEach(
      function (opt) {
        var variable = args.draw[opt]
        if (!variable) {
          return
        }
        scope.set(shared.draw, '.' + opt, '' + variable.append(env, scope))
      })

    sortedObjectKeys(args.uniforms).forEach(function (opt) {
      var value = args.uniforms[opt].append(env, scope)
      if (Array.isArray(value)) {
        value = '[' + value.join() + ']'
      }
      scope.set(
        shared.uniforms,
        '[' + stringStore.id(opt) + ']',
        value)
    })

    sortedObjectKeys(args.attributes).forEach(function (name) {
      var record = args.attributes[name].append(env, scope)
      var scopeAttrib = env.scopeAttrib(name)
      sortedObjectKeys(new AttributeRecord()).forEach(function (prop) {
        scope.set(scopeAttrib, '.' + prop, record[prop])
      })
    })

    if (args.scopeVAO) {
      scope.set(shared.vao, '.targetVAO', args.scopeVAO.append(env, scope))
    }

    function saveShader (name) {
      var shader = args.shader[name]
      if (shader) {
        scope.set(shared.shader, '.' + name, shader.append(env, scope))
      }
    }
    saveShader(S_VERT)
    saveShader(S_FRAG)

    if (sortedObjectKeys(args.state).length > 0) {
      scope(CURRENT_STATE, '.dirty=true;')
      scope.exit(CURRENT_STATE, '.dirty=true;')
    }

    scope('a1(', env.shared.context, ',a0,', env.batchId, ');')
  }

  function isDynamicObject (object) {
    if (typeof object !== 'object' || isArrayLike(object)) {
      return
    }
    var props = sortedObjectKeys(object)
    for (var i = 0; i < props.length; ++i) {
      if (dynamic.isDynamic(object[props[i]])) {
        return true
      }
    }
    return false
  }

  function splatObject (env, options, name) {
    var object = options.static[name]
    if (!object || !isDynamicObject(object)) {
      return
    }

    var globals = env.global
    var keys = sortedObjectKeys(object)
    var thisDep = false
    var contextDep = false
    var propDep = false
    var objectRef = env.global.def('{}')
    keys.forEach(function (key) {
      var value = object[key]
      if (dynamic.isDynamic(value)) {
        if (typeof value === 'function') {
          value = object[key] = dynamic.unbox(value)
        }
        var deps = createDynamicDecl(value, null)
        thisDep = thisDep || deps.thisDep
        propDep = propDep || deps.propDep
        contextDep = contextDep || deps.contextDep
      } else {
        globals(objectRef, '.', key, '=')
        switch (typeof value) {
          case 'number':
            globals(value)
            break
          case 'string':
            globals('"', value, '"')
            break
          case 'object':
            if (Array.isArray(value)) {
              globals('[', value.join(), ']')
            }
            break
          default:
            globals(env.link(value))
            break
        }
        globals(';')
      }
    })

    function appendBlock (env, block) {
      keys.forEach(function (key) {
        var value = object[key]
        if (!dynamic.isDynamic(value)) {
          return
        }
        var ref = env.invoke(block, value)
        block(objectRef, '.', key, '=', ref, ';')
      })
    }

    options.dynamic[name] = new dynamic.DynamicVariable(DYN_THUNK, {
      thisDep: thisDep,
      contextDep: contextDep,
      propDep: propDep,
      ref: objectRef,
      append: appendBlock
    })
    delete options.static[name]
  }

  // ===========================================================================
  // ===========================================================================
  // MAIN DRAW COMMAND
  // ===========================================================================
  // ===========================================================================
  function compileCommand (options, attributes, uniforms, context, stats) {
    var env = createREGLEnvironment()

    // link stats, so that we can easily access it in the program.
    env.stats = env.link(stats)

    // splat options and attributes to allow for dynamic nested properties
    sortedObjectKeys(attributes.static).forEach(function (key) {
      splatObject(env, attributes, key)
    })
    NESTED_OPTIONS.forEach(function (name) {
      splatObject(env, options, name)
    })

    var args = parseArguments(options, attributes, uniforms, context, env)

    emitDrawProc(env, args)
    emitScopeProc(env, args)
    emitBatchProc(env, args)

    return extend(env.compile(), {
      destroy: function () {
        args.shader.program.destroy()
      }
    })
  }

  // ===========================================================================
  // ===========================================================================
  // POLL / REFRESH
  // ===========================================================================
  // ===========================================================================
  return {
    next: nextState,
    current: currentState,
    procs: (function () {
      var env = createREGLEnvironment()
      var poll = env.proc('poll')
      var refresh = env.proc('refresh')
      var common = env.block()
      poll(common)
      refresh(common)

      var shared = env.shared
      var GL = shared.gl
      var NEXT_STATE = shared.next
      var CURRENT_STATE = shared.current

      common(CURRENT_STATE, '.dirty=false;')

      emitPollFramebuffer(env, poll)
      emitPollFramebuffer(env, refresh, null, true)

      // Refresh updates all attribute state changes
      var INSTANCING
      if (extInstancing) {
        INSTANCING = env.link(extInstancing)
      }

      // update vertex array bindings
      if (extensions.oes_vertex_array_object) {
        refresh(env.link(extensions.oes_vertex_array_object), '.bindVertexArrayOES(null);')
      }
      for (var i = 0; i < limits.maxAttributes; ++i) {
        var BINDING = refresh.def(shared.attributes, '[', i, ']')
        var ifte = env.cond(BINDING, '.buffer')
        ifte.then(
          GL, '.enableVertexAttribArray(', i, ');',
          GL, '.bindBuffer(',
          GL_ARRAY_BUFFER$2, ',',
          BINDING, '.buffer.buffer);',
          GL, '.vertexAttribPointer(',
          i, ',',
          BINDING, '.size,',
          BINDING, '.type,',
          BINDING, '.normalized,',
          BINDING, '.stride,',
          BINDING, '.offset);'
        ).else(
          GL, '.disableVertexAttribArray(', i, ');',
          GL, '.vertexAttrib4f(',
          i, ',',
          BINDING, '.x,',
          BINDING, '.y,',
          BINDING, '.z,',
          BINDING, '.w);',
          BINDING, '.buffer=null;')
        refresh(ifte)
        if (extInstancing) {
          refresh(
            INSTANCING, '.vertexAttribDivisorANGLE(',
            i, ',',
            BINDING, '.divisor);')
        }
      }
      refresh(
        env.shared.vao, '.currentVAO=null;',
        env.shared.vao, '.setVAO(', env.shared.vao, '.targetVAO);')

      sortedObjectKeys(GL_FLAGS).forEach(function (flag) {
        var cap = GL_FLAGS[flag]
        var NEXT = common.def(NEXT_STATE, '.', flag)
        var block = env.block()
        block('if(', NEXT, '){',
          GL, '.enable(', cap, ')}else{',
          GL, '.disable(', cap, ')}',
          CURRENT_STATE, '.', flag, '=', NEXT, ';')
        refresh(block)
        poll(
          'if(', NEXT, '!==', CURRENT_STATE, '.', flag, '){',
          block,
          '}')
      })

      sortedObjectKeys(GL_VARIABLES).forEach(function (name) {
        var func = GL_VARIABLES[name]
        var init = currentState[name]
        var NEXT, CURRENT
        var block = env.block()
        block(GL, '.', func, '(')
        if (isArrayLike(init)) {
          var n = init.length
          NEXT = env.global.def(NEXT_STATE, '.', name)
          CURRENT = env.global.def(CURRENT_STATE, '.', name)
          block(
            loop(n, function (i) {
              return NEXT + '[' + i + ']'
            }), ');',
            loop(n, function (i) {
              return CURRENT + '[' + i + ']=' + NEXT + '[' + i + '];'
            }).join(''))
          poll(
            'if(', loop(n, function (i) {
              return NEXT + '[' + i + ']!==' + CURRENT + '[' + i + ']'
            }).join('||'), '){',
            block,
            '}')
        } else {
          NEXT = common.def(NEXT_STATE, '.', name)
          CURRENT = common.def(CURRENT_STATE, '.', name)
          block(
            NEXT, ');',
            CURRENT_STATE, '.', name, '=', NEXT, ';')
          poll(
            'if(', NEXT, '!==', CURRENT, '){',
            block,
            '}')
        }
        refresh(block)
      })

      return env.compile()
    })(),
    compile: compileCommand
  }
}

function stats () {
  return {
    vaoCount: 0,
    bufferCount: 0,
    elementsCount: 0,
    framebufferCount: 0,
    shaderCount: 0,
    textureCount: 0,
    cubeCount: 0,
    renderbufferCount: 0,
    maxTextureUnits: 0
  }
}

var GL_QUERY_RESULT_EXT = 0x8866
var GL_QUERY_RESULT_AVAILABLE_EXT = 0x8867
var GL_TIME_ELAPSED_EXT = 0x88BF

var createTimer = function (gl, extensions) {
  if (!extensions.ext_disjoint_timer_query) {
    return null
  }

  // QUERY POOL BEGIN
  var queryPool = []
  function allocQuery () {
    return queryPool.pop() || extensions.ext_disjoint_timer_query.createQueryEXT()
  }
  function freeQuery (query) {
    queryPool.push(query)
  }
  // QUERY POOL END

  var pendingQueries = []
  function beginQuery (stats) {
    var query = allocQuery()
    extensions.ext_disjoint_timer_query.beginQueryEXT(GL_TIME_ELAPSED_EXT, query)
    pendingQueries.push(query)
    pushScopeStats(pendingQueries.length - 1, pendingQueries.length, stats)
  }

  function endQuery () {
    extensions.ext_disjoint_timer_query.endQueryEXT(GL_TIME_ELAPSED_EXT)
  }

  //
  // Pending stats pool.
  //
  function PendingStats () {
    this.startQueryIndex = -1
    this.endQueryIndex = -1
    this.sum = 0
    this.stats = null
  }
  var pendingStatsPool = []
  function allocPendingStats () {
    return pendingStatsPool.pop() || new PendingStats()
  }
  function freePendingStats (pendingStats) {
    pendingStatsPool.push(pendingStats)
  }
  // Pending stats pool end

  var pendingStats = []
  function pushScopeStats (start, end, stats) {
    var ps = allocPendingStats()
    ps.startQueryIndex = start
    ps.endQueryIndex = end
    ps.sum = 0
    ps.stats = stats
    pendingStats.push(ps)
  }

  // we should call this at the beginning of the frame,
  // in order to update gpuTime
  var timeSum = []
  var queryPtr = []
  function update () {
    var ptr, i

    var n = pendingQueries.length
    if (n === 0) {
      return
    }

    // Reserve space
    queryPtr.length = Math.max(queryPtr.length, n + 1)
    timeSum.length = Math.max(timeSum.length, n + 1)
    timeSum[0] = 0
    queryPtr[0] = 0

    // Update all pending timer queries
    var queryTime = 0
    ptr = 0
    for (i = 0; i < pendingQueries.length; ++i) {
      var query = pendingQueries[i]
      if (extensions.ext_disjoint_timer_query.getQueryObjectEXT(query, GL_QUERY_RESULT_AVAILABLE_EXT)) {
        queryTime += extensions.ext_disjoint_timer_query.getQueryObjectEXT(query, GL_QUERY_RESULT_EXT)
        freeQuery(query)
      } else {
        pendingQueries[ptr++] = query
      }
      timeSum[i + 1] = queryTime
      queryPtr[i + 1] = ptr
    }
    pendingQueries.length = ptr

    // Update all pending stat queries
    ptr = 0
    for (i = 0; i < pendingStats.length; ++i) {
      var stats = pendingStats[i]
      var start = stats.startQueryIndex
      var end = stats.endQueryIndex
      stats.sum += timeSum[end] - timeSum[start]
      var startPtr = queryPtr[start]
      var endPtr = queryPtr[end]
      if (endPtr === startPtr) {
        stats.stats.gpuTime += stats.sum / 1e6
        freePendingStats(stats)
      } else {
        stats.startQueryIndex = startPtr
        stats.endQueryIndex = endPtr
        pendingStats[ptr++] = stats
      }
    }
    pendingStats.length = ptr
  }

  return {
    beginQuery: beginQuery,
    endQuery: endQuery,
    pushScopeStats: pushScopeStats,
    update: update,
    getNumPendingQueries: function () {
      return pendingQueries.length
    },
    clear: function () {
      queryPool.push.apply(queryPool, pendingQueries)
      for (var i = 0; i < queryPool.length; i++) {
        extensions.ext_disjoint_timer_query.deleteQueryEXT(queryPool[i])
      }
      pendingQueries.length = 0
      queryPool.length = 0
    },
    restore: function () {
      pendingQueries.length = 0
      queryPool.length = 0
    }
  }
}

var GL_COLOR_BUFFER_BIT = 16384
var GL_DEPTH_BUFFER_BIT = 256
var GL_STENCIL_BUFFER_BIT = 1024

var GL_ARRAY_BUFFER = 34962

var CONTEXT_LOST_EVENT = 'webglcontextlost'
var CONTEXT_RESTORED_EVENT = 'webglcontextrestored'

var DYN_PROP = 1
var DYN_CONTEXT = 2
var DYN_STATE = 3

function find (haystack, needle) {
  for (var i = 0; i < haystack.length; ++i) {
    if (haystack[i] === needle) {
      return i
    }
  }
  return -1
}

function wrapREGL (args) {
  var config = parseArgs(args)
  if (!config) {
    return null
  }

  var gl = config.gl
  var glAttributes = gl.getContextAttributes()
  var contextLost = gl.isContextLost()

  var extensionState = createExtensionCache(gl, config)
  if (!extensionState) {
    return null
  }

  var stringStore = createStringStore()
  var stats$$1 = stats()
  var extensions = extensionState.extensions
  var timer = createTimer(gl, extensions)

  var START_TIME = clock()
  var WIDTH = gl.drawingBufferWidth
  var HEIGHT = gl.drawingBufferHeight

  var contextState = {
    tick: 0,
    time: 0,
    viewportWidth: WIDTH,
    viewportHeight: HEIGHT,
    framebufferWidth: WIDTH,
    framebufferHeight: HEIGHT,
    drawingBufferWidth: WIDTH,
    drawingBufferHeight: HEIGHT,
    pixelRatio: config.pixelRatio
  }
  var uniformState = {}
  var drawState = {
    elements: null,
    primitive: 4, // GL_TRIANGLES
    count: -1,
    offset: 0,
    instances: -1
  }

  var limits = wrapLimits(gl, extensions)
  var bufferState = wrapBufferState(
    gl,
    stats$$1,
    config,
    destroyBuffer)
  var elementState = wrapElementsState(gl, extensions, bufferState, stats$$1)
  var attributeState = wrapAttributeState(
    gl,
    extensions,
    limits,
    stats$$1,
    bufferState,
    elementState,
    drawState)
  function destroyBuffer (buffer) {
    return attributeState.destroyBuffer(buffer)
  }
  var shaderState = wrapShaderState(gl, stringStore, stats$$1, config)
  var textureState = createTextureSet(
    gl,
    extensions,
    limits,
    function () { core.procs.poll() },
    contextState,
    stats$$1,
    config)
  var renderbufferState = wrapRenderbuffers(gl, extensions, limits, stats$$1, config)
  var framebufferState = wrapFBOState(
    gl,
    extensions,
    limits,
    textureState,
    renderbufferState,
    stats$$1)
  var core = reglCore(
    gl,
    stringStore,
    extensions,
    limits,
    bufferState,
    elementState,
    textureState,
    framebufferState,
    uniformState,
    attributeState,
    shaderState,
    drawState,
    contextState,
    timer,
    config)
  var readPixels = wrapReadPixels(
    gl,
    framebufferState,
    core.procs.poll,
    contextState,
    glAttributes, extensions, limits)

  var nextState = core.next
  var canvas = gl.canvas

  var rafCallbacks = []
  var lossCallbacks = []
  var restoreCallbacks = []
  var destroyCallbacks = [config.onDestroy]

  var activeRAF = null
  function handleRAF () {
    if (rafCallbacks.length === 0) {
      if (timer) {
        timer.update()
      }
      activeRAF = null
      return
    }

    // schedule next animation frame
    activeRAF = raf.next(handleRAF)

    // poll for changes
    poll()

    // fire a callback for all pending rafs
    for (var i = rafCallbacks.length - 1; i >= 0; --i) {
      var cb = rafCallbacks[i]
      if (cb) {
        cb(contextState, null, 0)
      }
    }

    // flush all pending webgl calls
    gl.flush()

    // poll GPU timers *after* gl.flush so we don't delay command dispatch
    if (timer) {
      timer.update()
    }
  }

  function startRAF () {
    if (!activeRAF && rafCallbacks.length > 0) {
      activeRAF = raf.next(handleRAF)
    }
  }

  function stopRAF () {
    if (activeRAF) {
      raf.cancel(handleRAF)
      activeRAF = null
    }
  }

  function handleContextLoss (event) {
    event.preventDefault()

    // set context lost flag
    contextLost = true

    // pause request animation frame
    stopRAF()

    // lose context
    lossCallbacks.forEach(function (cb) {
      cb()
    })
  }

  function handleContextRestored (event) {
    // clear error code
    gl.getError()

    // clear context lost flag
    contextLost = false

    // refresh state
    extensionState.restore()
    shaderState.restore()
    bufferState.restore()
    textureState.restore()
    renderbufferState.restore()
    framebufferState.restore()
    attributeState.restore()
    if (timer) {
      timer.restore()
    }

    // refresh state
    core.procs.refresh()

    // restart RAF
    startRAF()

    // restore context
    restoreCallbacks.forEach(function (cb) {
      cb()
    })
  }

  if (canvas) {
    canvas.addEventListener(CONTEXT_LOST_EVENT, handleContextLoss, false)
    canvas.addEventListener(CONTEXT_RESTORED_EVENT, handleContextRestored, false)
  }

  function destroy () {
    rafCallbacks.length = 0
    stopRAF()

    if (canvas) {
      canvas.removeEventListener(CONTEXT_LOST_EVENT, handleContextLoss)
      canvas.removeEventListener(CONTEXT_RESTORED_EVENT, handleContextRestored)
    }

    shaderState.clear()
    framebufferState.clear()
    renderbufferState.clear()
    attributeState.clear()
    textureState.clear()
    elementState.clear()
    bufferState.clear()

    if (timer) {
      timer.clear()
    }

    destroyCallbacks.forEach(function (cb) {
      cb()
    })
  }

  function compileProcedure (options) {
    check$1(!!options, 'invalid args to regl({...})')
    check$1.type(options, 'object', 'invalid args to regl({...})')

    function flattenNestedOptions (options) {
      var result = extend({}, options)
      delete result.uniforms
      delete result.attributes
      delete result.context
      delete result.vao

      if ('stencil' in result && result.stencil.op) {
        result.stencil.opBack = result.stencil.opFront = result.stencil.op
        delete result.stencil.op
      }

      function merge (name) {
        if (name in result) {
          var child = result[name]
          delete result[name]
          Object.keys(child).forEach(function (prop) {
            result[name + '.' + prop] = child[prop]
          })
        }
      }
      merge('blend')
      merge('depth')
      merge('cull')
      merge('stencil')
      merge('polygonOffset')
      merge('scissor')
      merge('sample')

      if ('vao' in options) {
        result.vao = options.vao
      }

      return result
    }

    function separateDynamic (object, useArrays) {
      var staticItems = {}
      var dynamicItems = {}
      Object.keys(object).forEach(function (option) {
        var value = object[option]
        if (dynamic.isDynamic(value)) {
          dynamicItems[option] = dynamic.unbox(value, option)
          return
        } else if (useArrays && Array.isArray(value)) {
          for (var i = 0; i < value.length; ++i) {
            if (dynamic.isDynamic(value[i])) {
              dynamicItems[option] = dynamic.unbox(value, option)
              return
            }
          }
        }
        staticItems[option] = value
      })
      return {
        dynamic: dynamicItems,
        static: staticItems
      }
    }

    // Treat context variables separate from other dynamic variables
    var context = separateDynamic(options.context || {}, true)
    var uniforms = separateDynamic(options.uniforms || {}, true)
    var attributes = separateDynamic(options.attributes || {}, false)
    var opts = separateDynamic(flattenNestedOptions(options), false)

    var stats$$1 = {
      gpuTime: 0.0,
      cpuTime: 0.0,
      count: 0
    }

    var compiled = core.compile(opts, attributes, uniforms, context, stats$$1)

    var draw = compiled.draw
    var batch = compiled.batch
    var scope = compiled.scope

    // FIXME: we should modify code generation for batch commands so this
    // isn't necessary
    var EMPTY_ARRAY = []
    function reserve (count) {
      while (EMPTY_ARRAY.length < count) {
        EMPTY_ARRAY.push(null)
      }
      return EMPTY_ARRAY
    }

    function REGLCommand (args, body) {
      var i
      if (contextLost) {
        check$1.raise('context lost')
      }
      if (typeof args === 'function') {
        return scope.call(this, null, args, 0)
      } else if (typeof body === 'function') {
        if (typeof args === 'number') {
          for (i = 0; i < args; ++i) {
            scope.call(this, null, body, i)
          }
        } else if (Array.isArray(args)) {
          for (i = 0; i < args.length; ++i) {
            scope.call(this, args[i], body, i)
          }
        } else {
          return scope.call(this, args, body, 0)
        }
      } else if (typeof args === 'number') {
        if (args > 0) {
          return batch.call(this, reserve(args | 0), args | 0)
        }
      } else if (Array.isArray(args)) {
        if (args.length) {
          return batch.call(this, args, args.length)
        }
      } else {
        return draw.call(this, args)
      }
    }

    return extend(REGLCommand, {
      stats: stats$$1,
      destroy: function () {
        compiled.destroy()
      }
    })
  }

  var setFBO = framebufferState.setFBO = compileProcedure({
    framebuffer: dynamic.define.call(null, DYN_PROP, 'framebuffer')
  })

  function clearImpl (_, options) {
    var clearFlags = 0
    core.procs.poll()

    var c = options.color
    if (c) {
      gl.clearColor(+c[0] || 0, +c[1] || 0, +c[2] || 0, +c[3] || 0)
      clearFlags |= GL_COLOR_BUFFER_BIT
    }
    if ('depth' in options) {
      gl.clearDepth(+options.depth)
      clearFlags |= GL_DEPTH_BUFFER_BIT
    }
    if ('stencil' in options) {
      gl.clearStencil(options.stencil | 0)
      clearFlags |= GL_STENCIL_BUFFER_BIT
    }

    check$1(!!clearFlags, 'called regl.clear with no buffer specified')
    gl.clear(clearFlags)
  }

  function clear (options) {
    check$1(
      typeof options === 'object' && options,
      'regl.clear() takes an object as input')
    if ('framebuffer' in options) {
      if (options.framebuffer &&
          options.framebuffer_reglType === 'framebufferCube') {
        for (var i = 0; i < 6; ++i) {
          setFBO(extend({
            framebuffer: options.framebuffer.faces[i]
          }, options), clearImpl)
        }
      } else {
        setFBO(options, clearImpl)
      }
    } else {
      clearImpl(null, options)
    }
  }

  function frame (cb) {
    check$1.type(cb, 'function', 'regl.frame() callback must be a function')
    rafCallbacks.push(cb)

    function cancel () {
      // FIXME:  should we check something other than equals cb here?
      // what if a user calls frame twice with the same callback...
      //
      var i = find(rafCallbacks, cb)
      check$1(i >= 0, 'cannot cancel a frame twice')
      function pendingCancel () {
        var index = find(rafCallbacks, pendingCancel)
        rafCallbacks[index] = rafCallbacks[rafCallbacks.length - 1]
        rafCallbacks.length -= 1
        if (rafCallbacks.length <= 0) {
          stopRAF()
        }
      }
      rafCallbacks[i] = pendingCancel
    }

    startRAF()

    return {
      cancel: cancel
    }
  }

  // poll viewport
  function pollViewport () {
    var viewport = nextState.viewport
    var scissorBox = nextState.scissor_box
    viewport[0] = viewport[1] = scissorBox[0] = scissorBox[1] = 0
    contextState.viewportWidth =
      contextState.framebufferWidth =
      contextState.drawingBufferWidth =
      viewport[2] =
      scissorBox[2] = gl.drawingBufferWidth
    contextState.viewportHeight =
      contextState.framebufferHeight =
      contextState.drawingBufferHeight =
      viewport[3] =
      scissorBox[3] = gl.drawingBufferHeight
  }

  function poll () {
    contextState.tick += 1
    contextState.time = now()
    pollViewport()
    core.procs.poll()
  }

  function refresh () {
    textureState.refresh()
    pollViewport()
    core.procs.refresh()
    if (timer) {
      timer.update()
    }
  }

  function now () {
    return (clock() - START_TIME) / 1000.0
  }

  refresh()

  function addListener (event, callback) {
    check$1.type(callback, 'function', 'listener callback must be a function')

    var callbacks
    switch (event) {
      case 'frame':
        return frame(callback)
      case 'lost':
        callbacks = lossCallbacks
        break
      case 'restore':
        callbacks = restoreCallbacks
        break
      case 'destroy':
        callbacks = destroyCallbacks
        break
      default:
        check$1.raise('invalid event, must be one of frame,lost,restore,destroy')
    }

    callbacks.push(callback)
    return {
      cancel: function () {
        for (var i = 0; i < callbacks.length; ++i) {
          if (callbacks[i] === callback) {
            callbacks[i] = callbacks[callbacks.length - 1]
            callbacks.pop()
            return
          }
        }
      }
    }
  }

  var regl = extend(compileProcedure, {
    // Clear current FBO
    clear: clear,

    // Short cuts for dynamic variables
    prop: dynamic.define.bind(null, DYN_PROP),
    context: dynamic.define.bind(null, DYN_CONTEXT),
    this: dynamic.define.bind(null, DYN_STATE),

    // executes an empty draw command
    draw: compileProcedure({}),

    // Resources
    buffer: function (options) {
      return bufferState.create(options, GL_ARRAY_BUFFER, false, false)
    },
    elements: function (options) {
      return elementState.create(options, false)
    },
    texture: textureState.create2D,
    cube: textureState.createCube,
    renderbuffer: renderbufferState.create,
    framebuffer: framebufferState.create,
    framebufferCube: framebufferState.createCube,
    vao: attributeState.createVAO,

    // Expose context attributes
    attributes: glAttributes,

    // Frame rendering
    frame: frame,
    on: addListener,

    // System limits
    limits: limits,
    hasExtension: function (name) {
      return limits.extensions.indexOf(name.toLowerCase()) >= 0
    },

    // Read pixels
    read: readPixels,

    // Destroy regl and all associated resources
    destroy: destroy,

    // Direct GL state manipulation
    _gl: gl,
    _refresh: refresh,

    poll: function () {
      poll()
      if (timer) {
        timer.update()
      }
    },

    // Current time
    now: now,

    // regl Statistics Information
    stats: stats$$1
  })

  config.onDone(null, regl)

  return regl
}

return wrapREGL;

})));
//# sourceMappingURL=regl.js.map
