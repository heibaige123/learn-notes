# 会咬人的地方

> 每条都是本机跑出来的实际结果，命令能直接复制。
> 原理在 [walkthrough](validate-walkthrough.md)，这里只讲「会看到什么」。
>
> 下文 `V` 指 `require('json-schema/lib/validate.js')`，`validate` 指 `V.validate`。

## 1. `integer` 接受数字字符串

```js
validate('5', { type: 'integer' }); // valid: true
validate('5', { type: 'number' }); // valid: false
```

原因：整数判断只看 `value % 1 === 0`，字符串取模会隐式转成数字，所以 `"5"` 被当成整数放过去了（`validate.js` 的 `checkType`）。`number` 走的是 `typeof value != type`，因此照常拒绝。

## 2. draft-04 的 `required` 数组完全不生效

```js
validate({}, { properties: { a: { type: 'string' } }, required: ['a'] });
// valid: true —— a 明明缺了
```

代码只认属性上的布尔 `required: true`，对象级的数组写法从没被读过（`checkProp` 里 `if (schema.required)`）。

反过来，空数组也是真值，会误报：

```js
validate({}, { properties: { a: { type: 'string', required: [] } } });
// valid: false —— property "a"，message "is missing and it is required"
```

## 3. 一批关键字只是「没实现」

下面这些写进去和没写完全一样，不会报错也不会生效：

`format`、`uniqueItems`、`divisibleBy`、`$ref`、`dependencies`、`patternProperties`、`additionalItems`、`exclusiveMinimum`、`exclusiveMaximum`、`minProperties`、`maxProperties`。

```js
validate('nope', { type: 'string', format: 'email' }); // valid: true
validate([1, 1], { type: 'array', uniqueItems: true }); // valid: true
validate({ x1: 'a' }, { patternProperties: { '^x': { type: 'number' } } }); // valid: true
validate({ a: 'str' }, { properties: { a: { $ref: '#/definitions/n' } } }); // valid: true
```

`$ref` 只是普通字段，永远不会被解引用。这条决定了它没法处理任何真实世界的现代 schema。

## 4. `default` 的假值不写回

```js
const o = {};
V._validate(o, { properties: { n: { type: 'number', default: 0 } } });
// o 还是 {}
```

条件是 `propDef["default"]` 本身为真（`checkObj` 第一轮），所以 `0`、`""`、`false` 都不算有默认值。

## 5. `$schema` 写成 URI 会直接报错

```js
validate({ a: 1, $schema: 'http://json-schema.org/draft-03/schema#' });
// {"valid":false,"errors":[{"property":"","message":"Invalid schema/property definition http://..."}]}
```

`_validate` 末尾把实例的 `$schema` 当成 **schema 对象**再校验一遍，没做 URI 解析。所以这个字段只适合塞一个内联 schema。

连规范自己的 `draft-03/schema` 都过不了这一关 —— 它顶上就有 `"$schema": "http://…"`。测试里那些 `-nsd`（no `$schema`）的用例，就是为了绕开这个。

## 6. 嵌套 `type` 会给路径加个 `undefined`

```js
validate({ a: 'x' }, { type: { properties: { a: { type: 'number' } } } });
// property: "undefined.a"
```

`checkType` 递归调 `checkProp(value, type, path)` 时没传 `i`，而 path 是空串，于是走了 `path += i`，`'' + undefined` 成了 `"undefined"`。

## 7. 顶层数组的元素路径没有方括号

```js
validate([1], { items: { type: 'string' } });
// property: "0"
```

`[i]` 这个格式只在路径已经非空时用；根路径为空时是 `'' + i`，所以只有 `0`、`1`。嵌套一层就正常了：`user.tags[0]`。

## 8. 数组绕过 `checkObj`

```js
validate([1], { type: 'object', properties: { a: { type: 'number' } } });
// valid: true
validate('x', { type: 'object', properties: { a: { type: 'number' } } });
// valid: false —— "an object is required"
```

`checkProp` 里 `if (value instanceof Array)` 和 `else if (properties)` 是互斥分支，数组在上一层就被分走了，`checkObj` 里那句数组判断永远走不到。

## 9. `null` 只过类型，其余约束全跳过

```js
validate(null, { type: 'object', properties: { a: { required: true } } });
// valid: true
```

所有属性、枚举、长度的检查都包在 `if (value !== null)` 里。`required` 也不管 `null`，因为它只判断 `value === undefined`。

## 10. 两处 `errors.concat` 是空操作

```js
errors.concat(checkProp(value[i], propDef, path, i));
errors.concat(checkObj(value, schema.properties, path, schema.additionalProperties));
```

`concat` 返回新数组，这里返回值被丢掉了。看着像漏写 `errors =`，实际没丢错误 —— 更深的 `addError` 是往闭包里的同一个 `errors` 数组 `push` 的。能跑，但别照抄这种写法。

## 11. 错误文案是硬拼的

```js
validate(1, { type: 'string' }).errors[0].message;
// "1 - number value found, but a string is required"
validate(1, { type: 'integer' }).errors[0].message;
// "1 - number value found, but a integer is required"
```

模板是 `"but a " + type`，所以 `a integer`、`a object` 都会出现。如果你拿错误文本做断言或展示，先习惯这个语法。
