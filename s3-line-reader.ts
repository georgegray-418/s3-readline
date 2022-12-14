import { GetObjectCommand, S3, S3ClientConfig } from '@aws-sdk/client-s3';
export class S3LineReader {
  private byteOffset = 0;
  private partial: string = '';
  private readonly s3: S3;
  private size = 0;
  private generator: AsyncGenerator<string, string, unknown> | undefined;
  private lineDelimiter: string = '\n';
  private readonly bufferSize = 1024 * 128;
  /**
   * Class to get data from an s3 object and yield it to a calling process line by line,
   * the line delimiter can be specified in calls to {@link getLines} and defaults to '\n'
   * This class will not load more than specified {@link bufferSize} or the longest line from
   * the s3 file (whichever is greater) into memory at any given point.
   * @param bucket the s3 bucket to pull data form
   * @param key the key of the object to pull data form
   * @param config an object containing
   *  * s3Config an s3 config object, defaults to {}
   *  * bufferSize the number of bytes to pull form s3 in each request, defaults to 128 kib
   *  * lineDelimiter the charchter sequence indicating a newline in the file, defaults to '\n'
   */
  constructor(private bucket: string, private key: string, config: { s3Config?: S3ClientConfig; bufferSize?: number; lineDelimiter?: string } = {}) {
    this.s3 = new S3(config.s3Config || {});
    this.lineDelimiter = config.lineDelimiter || this.lineDelimiter;
    this.bufferSize = config.bufferSize || this.bufferSize;
  }

  /**
   * Generator function to request the next line from s3, the next chunk fo data will be queried form s3
   *  when the buffer is empty:
   *
   * ```typescript
   * const reader = new S3LineReader('my-bucket','my-object');
   * const lines = reader.getLines();
   *
   * for await (let line of lines) {
   *  console.log(line);
   * }
   *
   * ```
   * @returns
   */
  public getLines(): AsyncGenerator<string, string, unknown> {
    if (!this.generator) this.generator = this.getLinesGenerator();
    return this.generator;
  }

  private async *getLinesGenerator() {
    // Grab the file size
    const headObject = await this.s3.headObject({
      Bucket: this.bucket,
      Key: this.key,
    });
    this.size = headObject.ContentLength ?? 0;

    while (this.byteOffset < this.size) {
      // Calculate the upper range for the current request
      let byteOffsetTop = this.byteOffset + this.bufferSize;
      if (byteOffsetTop > this.size) byteOffsetTop = this.size;

      const file = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.key,
          Range: `bytes=${this.byteOffset}-${byteOffsetTop}`,
        }),
      );

      // increment the byteOffset
      // GetObjectCommand's Range is inclusive, start at the byte after the previous range provided.
      this.byteOffset = byteOffsetTop + 1;

      // Nothing returned, we've hit the end of the file.
      if (!file.Body) break;
      let data = await this.readStream(file.Body as NodeJS.ReadableStream);

      // Prepend any data from the previous chunk that was missing a newline.
      data = this.partial + data;
      this.partial = '';

      // While there is data in the last chunk from s3
      while (data.length) {
        let nextNewline = data.indexOf(this.lineDelimiter);
        // If we've not found a newline, we're at the end of a chunk,
        // save the partial line in a class member and fetch the next chunk
        if (nextNewline === -1) {
          this.partial = data;
          break;
        }
        // a newline was found, grab the current line.
        yield data.substring(0, nextNewline);
        // Remove the returned line form the current chunk.
        data = data.substring(nextNewline + this.lineDelimiter.length);
      }
    }
    // anything left in the partial buffer is the last line of the file.
    return this.partial;
  }

  private async readStream(stream: NodeJS.ReadableStream): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let buffer = '';
      stream.on('data', (d) => {
        buffer += d;
      });
      stream.on('end', () => resolve(buffer));
      stream.on('error', (e) => reject(e));
    });
  }
}
