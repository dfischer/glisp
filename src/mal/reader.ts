import isNodeJS from 'is-node'
import {
	MalError,
	MalSymbol,
	MalMap,
	MalVal,
	MalNil,
	MalBoolean,
	MalNumber,
	MalString,
	MalVector,
	MalList,
	MalKeyword,
	MalColl,
	isMalSeq,
	MalFn,
	isMal,
	MalAtom,
	MalCallableValue,
} from './types'

export class MalBlankException extends MalError {}
export class MalReadError extends MalError {}

class Reader {
	private strlen: number
	private index: number

	private tokens!: [string, number][]

	constructor(private str: string) {
		// Tokenize

		// eslint-disable-next-line no-useless-escape
		const tokenRe = /[\s,]*(~@|[\[\]{}()'`~^@#]|"(?:\\.|[^\\"])*"|;.*|[^\s\[\]{}('"`,;)]*)/g
		const spaceRe = /^[\s,]*/

		let match, spaceMatch, spaceOffset

		const tokens: [string, number][] = []

		while ((match = tokenRe.exec(str)) && match[1] != '') {
			if (match[1][0] === ';') {
				continue
			}

			spaceMatch = spaceRe.exec(match[0])
			spaceOffset = spaceMatch ? spaceMatch[0].length : 0

			tokens.push([match[1], match.index + spaceOffset])
		}

		// Check if empty
		if (tokens.length === 0) {
			throw new MalBlankException()
		}

		this.tokens = tokens

		this.strlen = str.length
		this.index = 0
	}

	public didReachEnd() {
		return this.index === this.tokens.length - 1
	}

	public next() {
		const token = this.tokens[this.index++]
		if (!token) {
			throw new MalReadError('Invalid end of file')
		}
		return token[0]
	}

	public peek(offset = 0) {
		const token = this.tokens[this.index + offset]
		if (!token) {
			throw new MalReadError('Invalid end of file')
		}
		return token[0]
	}

	public lastDelimiter() {
		const start = this.endOffset()
		const end = this.offset()

		return this.str.slice(start, end)
	}

	private offset() {
		const token = this.tokens[this.index]
		return token !== undefined ? token[1] : this.strlen
	}

	private endOffset(offset = 0) {
		const token = this.tokens[this.index + offset]
		return token !== undefined ? token[1] + token[0].length : this.strlen
	}
}

function readAtom(reader: Reader) {
	const token = reader.next()

	if (typeof token === 'string') {
		if (token.match(/^[-+]?[0-9]+$/)) {
			// integer
			return MalNumber.create(parseInt(token, 10))
		} else if (token.match(/^[-+]?([0-9]*\.[0-9]+|[0-9]+)$/)) {
			// float
			return MalNumber.create(parseFloat(token))
		} else if (token.match(/^"(?:\\.|[^\\"])*"$/)) {
			// string
			return MalString.create(
				token
					.slice(1, token.length - 1)
					.replace(/\\(.)/g, (_: any, c: string) => (c === 'n' ? '\n' : c)) // handle new line
			)
		} else if (token[0] === '"') {
			throw new MalReadError("Expected '\"', got EOF")
		} else if (token[0] === ':') {
			return MalKeyword.create(token.slice(1))
		} else if (token === 'nil') {
			return MalNil.create()
		} else if (token === 'true') {
			return MalBoolean.create(true)
		} else if (token === 'false') {
			return MalBoolean.create(false)
		} else if (/^NaN$|^-?Infinity$/.test(token)) {
			return MalNumber.create(parseFloat(token))
		} else {
			// symbol
			return MalSymbol.create(token as string)
		}
	} else {
		return token
	}
}

// read syntactic sugar and return MalList
function readSyntacticSugar(reader: Reader, name: string, count: number) {
	const coll: MalVal[] = [MalSymbol.create(name)]
	const delimiters: string[] = ['']

	const sugarSymbol = reader.next()

	for (let i = 0; i < count; i++) {
		delimiters.push(reader.lastDelimiter())

		coll.push(readForm(reader))
	}

	delimiters.push('')

	const list = MalList.create(coll)
	list.sugar = sugarSymbol
	list.delimiters = delimiters

	return list
}

// read list of tokens
function readColl(reader: Reader, start = '[', end = ']') {
	const coll: MalVal[] = []

	const delimiters: string[] = []

	let token = reader.next()

	if (token !== start) {
		throw new MalReadError(`Expected '${start}'`)
	}

	while ((token = reader.peek()) !== end) {
		if (!token) {
			throw new MalReadError(`Expected '${end}', got EOF`)
		}

		// Save delimiter
		delimiters?.push(reader.lastDelimiter())

		coll.push(readForm(reader))
	}

	// Save a delimiter between a last element and a end tag
	delimiters.push(reader.lastDelimiter())

	reader.next()
	return {
		coll,
		delimiters,
	}
}

// read vector of tokens
function readVector(reader: Reader) {
	const {coll, delimiters} = readColl(reader, '[', ']')
	const vec = MalVector.create(coll)
	vec.delimiters = delimiters
	return vec
}

function readList(reader: Reader) {
	const {coll, delimiters} = readColl(reader, '(', ')')
	const list = MalList.create(coll)
	list.delimiters = delimiters
	return list
}

// read hash-map key/value pairs
function readMap(reader: Reader) {
	const {coll, delimiters} = readColl(reader, '{', '}')
	const map = MalMap.fromSeq(coll)
	map.delimiters = delimiters
	return map
}

function readForm(reader: Reader): any {
	const token = reader.peek()

	switch (token) {
		// reader macros
		case ';':
			return MalNil.create()
		case "'":
			return readSyntacticSugar(reader, 'quote', 1)
		case '`':
			return readSyntacticSugar(reader, 'quasiquote', 1)
		case '~':
			return readSyntacticSugar(reader, 'unquote', 1)
		case '~@':
			return readSyntacticSugar(reader, 'splice-unquote', 1)
		case '^': {
			return readSyntacticSugar(reader, 'with-meta-sugar', 2)
		}
		case '@':
			return readSyntacticSugar(reader, 'deref', 1)
		case '#': {
			const type = reader.peek(+1)
			if (type === '(') {
				// Aanonymous function: #( )
				return readSyntacticSugar(reader, 'fn-sugar', 1)
			} else {
				throw new MalReadError('Invalid # syntactic sugar')
			}
		}

		// list
		case ')':
			throw new MalReadError("unexpected ')'")
		case '(':
			return readList(reader)

		// vector
		case ']':
			throw new MalReadError("unexpected ']'")
		case '[':
			return readVector(reader)

		// hash-map
		case '}':
			throw new MalReadError("unexpected '}'")
		case '{':
			return readMap(reader)

		// atom
		default:
			return readAtom(reader)
	}
}

export default function readStr(str: string): MalVal {
	const reader = new Reader(str)
	const exp = readForm(reader)

	if (reader.didReachEnd()) {
		throw new MalReadError('Invalid end of file')
	}

	reconstructTree(exp)

	return exp
}

export function readJS(obj: number | MalNumber): MalNumber
export function readJS(obj: string | MalString): MalString
export function readJS(obj: MalKeyword): MalKeyword
export function readJS(obj: MalSymbol): MalSymbol
export function readJS(obj: boolean | MalBoolean): MalBoolean
export function readJS(obj: null | undefined | MalNil): MalNil
export function readJS(obj: MalCallableValue | MalFn): MalFn
export function readJS(obj: MalList): MalList
export function readJS(obj: any[] | Float32Array | MalVector): MalVector
export function readJS(obj: {[k: string]: any} | MalMap): MalMap
export function readJS(obj: MalAtom): MalAtom
export function readJS(obj: any): MalVal {
	if (isMal(obj)) {
		// MalVal
		return obj
	} else if (Array.isArray(obj)) {
		// Vector
		return MalVector.create(obj.map(readJS))
	} else if (obj instanceof Float32Array) {
		// Numeric Vector
		return MalVector.create(Array.from(obj).map(x => MalNumber.create(x)))
	} else if (obj instanceof Function) {
		// Function
		return MalFn.create(obj)
	} else if (obj instanceof Object) {
		// Map
		const ret: {[k: string]: MalVal} = {}
		for (const [key, value] of Object.entries(obj)) {
			ret[key] = readJS(value as any)
		}
		return MalMap.create(ret)
	} else if (obj === null || obj === undefined) {
		// Nil
		return MalNil.create()
	} else {
		switch (typeof obj) {
			case 'number':
				return MalNumber.create(obj)
			case 'string':
				return MalString.create(obj)
			case 'boolean':
				return MalBoolean.create(obj)
			default:
				return MalNil.create()
		}
	}
}

export const slurp = (() => {
	if (isNodeJS) {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const fs = require('fs')
		return (url: string) => {
			return fs.readFileSync(url.replace(/^file:\/\//, ''), 'UTF-8')
		}
	} else {
		return (url: string) => {
			const req = new XMLHttpRequest()
			req.open('GET', url, false)
			req.send()
			if (req.status !== 200) {
				throw new MalError(`Failed to slurp file: ${url}`)
			}
			return req.responseText
		}
	}
})()

export function reconstructTree(exp: MalVal) {
	seek(exp)

	function seek(exp: MalVal, parent?: {ref: MalColl; index: number}) {
		if (parent) {
			exp.parent = parent
		}

		if (isMalSeq(exp)) {
			exp.value.forEach((child, index) => seek(child, {ref: exp, index}))
		} else if (MalMap.is(exp)) {
			exp
				.entries()
				.forEach(([, child], index) => seek(child, {ref: exp, index}))
		}
	}
}
