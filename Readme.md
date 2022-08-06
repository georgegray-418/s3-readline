# S3 Readline

S3 readline is a utility class that exposes an s3 object via an async generator function allowing you to 'pull' from the file one line at a time (you can use any string as a delimiter, not just newlines). This is advantageous if you want to process a file in small chunks (like lines) without loading the entire file into memory.

## Usage

### Simple Usage

```typescript
// initialize the line reader with a bucket and object
// By default, the file will be downloaded in 128 kib chunks
const reader: S3LineReader = new S3LineReader('some-s3-bucket', 'hugefile.txt');
const lines = reader.getLines();
// Iterate our lines, new chunks will only be pulled when the existing chunk has been
// fully processed (in out example, logged)
for await (let line of lines) {
  console.log(line);
}
```

### Custom chunk size

You can control the size of the chunks the file is downloaded in by setting the bufferSize in the constructor, generally the utility will only ever hold a single chunk in memory, but it may need to hold more if you have very long lines (and multiple chunks have to be combined to return a line)

```typescript
// Download the file in 1024 byte chunks, this will result is a large number of total
// calls to Aws (and likely worse performance) but a much smaller memory footprint.
const reader: S3LineReader = new S3LineReader('some-s3-bucket', 'hugefile.txt', {}, 1024);
```

### Custom S3ClientConfig

The third argument to the constructor is the S3ClientConfig that is passed to the underlying
S3 object from `'@aws-sdk/client-s3'`, documentation for this object can be found in the [aws documentation](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-s3/interfaces/s3clientconfig.html)

```typescript
const reader: S3LineReader = new S3LineReader('some-s3-bucket', 'hugefile.txt', {
  region: 'eu-west-2',
  ...config,
});
```

### Custom delimiters

You can use any string as a delimiter, by default, if no specified the delimiter is `\n`. If you wanted to split lines on the windows convention of `\r\n` you can pass it to `getLines`:

```typescript
const lines = reader.getLines('\r\n');
```

if you wanted to split your file on the word `spoons`:

```typescript
// for a file with the contents: 'abcspoons123spoons xyz spoons 456'
const lines = reader.getLines('spoons');
for await (let line of lines) console.log(line);
// would log:
// 'abc'
// '123'
// ' xyz '
// ' 456'
```
