import { GetObjectCommand, GetObjectCommandInput, GetObjectCommandOutput, S3, S3ClientConfig } from '@aws-sdk/client-s3';
export class S3LineReader {
  private byteOffset = 0;
  private partial: string = '';
  private readonly s3: S3;
  private size = 0;

  /**
   * Class to get data from an s3 object and yield it to a calling process in line chunks,
   * a line is currently denoted by a utf-8 '\n' character.
   * This class will not load more than specified {@link bufferSize} into memory at any given point.
   * @param bucket the s3 bucket to pull data form
   * @param key the key of the object to pull data form
   * @param s3Config an s3 config object, defaults to {}
   * @param bufferSize the number of bytes to pull form s3 in each request, defaults to 128 kib
   */
  constructor(private bucket: string, private key: string, private readonly bufferSize = 1024 * 128, s3Config: S3ClientConfig = {}) {
    this.s3 = new S3(s3Config);
  }

  /**
   * Generator function to request the next line from s3, the next chunk fo data will be queried form s3
   *  when the buffer is empty:
   *
   * ```typescript
   * const reader = new S3LineReader('my-bucket','my-object');
   * const lineIterator = reader.getLines();
   *
   * let line:IteratorResult<string,void>;
   * do {
   *  line = await lineIterator.next();
   *  // do stuff with line.value
   * } while (!line.done)
   *
   * ```
   * @param lineDelimiter character or string that represents a newline in the file.
   * @returns
   */
  public async *getLines(lineDelimiter: string = '\n') {
    // Grab the filesize
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
      // increment the byteOffset, GetObjectCommand's Range is inclusive, start at the byte after the previous range provided.
      this.byteOffset = byteOffsetTop + 1;

      // Nothing returned, we've hit the end of the file.
      if (!file.Body) break;
      let data = await this.readStream(file.Body as NodeJS.ReadableStream);
      // While there is data in the last chunk from s3
      while (data.length) {
        let nextNewline = data.indexOf(lineDelimiter);
        // If we've not found a newline, we're at the end of a chunk,
        // save the partial line in a class member and fetch the next chunk
        if (nextNewline === -1) {
          this.partial += data;
          // check if a newline is present when any data left in the previous chunk is
          // prepended to this chunk
          if (this.partial.indexOf(lineDelimiter) !== -1) {
            // if so, set this chunk to the combination of the partial and this chunk and
            // restart processing of this chunk.
            data = this.partial;
            this.partial = '';
            continue;
          }
          // If not, there are no more lines to process in this chunk.
          break;
        }

        // a newline was found, grab the current line.
        let nextLine = data.substring(0, nextNewline);
        if (this.partial) {
          // If something was in the partial member, we had data left over form the previous
          // chunk, append this to it clear the partial data.
          nextLine = this.partial + nextLine;
          this.partial = '';
        }
        // Return line.
        yield nextLine;
        // Remove the returned line form the current chunk.
        data = data.substring(nextNewline + lineDelimiter.length);
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
