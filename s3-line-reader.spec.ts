import { GetObjectCommand, HeadObjectCommandOutput, S3 } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { S3LineReader } from './s3-line-reader';

jest.mock('@aws-sdk/client-s3', () => ({
  ...jest.requireActual('@aws-sdk/client-s3'),
  S3: jest.fn(),
}));

describe('S3LineReader', () => {
  describe('when the object contains a multiple lines', () => {
    const data = `This is the first line
This is the second line`;

    const dataBuffer = Buffer.from(data);
    beforeEach(() => {
      S3.prototype.headObject = jest.fn().mockResolvedValue({ ContentLength: dataBuffer.length });
      S3.prototype.send = getObjectMock(dataBuffer);
    });
    it('should return a single line if the source object only contains a single line.', async () => {
      const reader = new S3LineReader('some-bucket', 'some-key');
      const lines = reader.getLines();
      let line = await lines.next();
      expect(line.done).toBe(false);
      expect(line.value).toEqual('This is the first line');
      line = await lines.next();
      expect(line.done).toBe(true);
      expect(line.value).toEqual('This is the second line');
    });
    it('should return a single line if the source object only contains a single line and the buffer is smaller than the line', async () => {
      const reader = new S3LineReader('some-bucket', 'some-key', 8);
      const lines = reader.getLines();
      let line = await lines.next();
      expect(line.done).toBe(false);
      expect(line.value).toEqual('This is the first line');
      line = await lines.next();
      expect(line.done).toBe(true);
      expect(line.value).toEqual('This is the second line');
    });
  });
  describe('when the object contains a single line without a newline', () => {
    const lineString = `This is a single line`;
    const lineBuffer = Buffer.from(lineString);
    beforeEach(() => {
      S3.prototype.headObject = jest.fn().mockResolvedValue({ ContentLength: lineBuffer.length });
      S3.prototype.send = getObjectMock(lineBuffer);
    });

    it('should return a single line if the source object only contains a single line.', async () => {
      const reader = new S3LineReader('some-bucket', 'some-key');
      const lines = reader.getLines();
      const line = await lines.next();
      expect(line.value).toEqual(lineString);
      expect(line.done).toBe(true);
    });
    it('should return a single line if the source object only contains a single line. and the buffer is smaller than the line', async () => {
      const reader = new S3LineReader('some-bucket', 'some-key', 8);
      const lines = reader.getLines();
      const line = await lines.next();
      expect(line.value).toEqual(lineString);
      expect(line.done).toBe(true);
    });
  });

  describe('when the object contains empty lines', () => {
    const data = `

Not Empty line
short line

`;
    const dataBuffer = Buffer.from(data);
    beforeEach(() => {
      S3.prototype.headObject = jest.fn().mockResolvedValue({ ContentLength: dataBuffer.length });
      S3.prototype.send = getObjectMock(dataBuffer);
    });

    it('should return all the lines in order including empty lines', async () => {
      const reader = new S3LineReader('some-bucket', 'some-key', 8);
      const lines = reader.getLines();
      let line = await lines.next();
      expect(line.value).toEqual('');
      expect(line.done).toBe(false);
      line = await lines.next();
      expect(line.value).toEqual('');
      expect(line.done).toBe(false);
      line = await lines.next();
      expect(line.value).toEqual('Not Empty line');
      expect(line.done).toBe(false);
      line = await lines.next();
      expect(line.value).toEqual('short line');
      expect(line.done).toBe(false);
      line = await lines.next();
      expect(line.value).toEqual('');
      expect(line.done).toBe(false);
      line = await lines.next();
      expect(line.value).toEqual('');
      expect(line.done).toBe(true);
    });
  });

  describe('when the object is using multi char newlines', () => {
    const data = `This is the first line\r\nThis is the second line`;

    const dataBuffer = Buffer.from(data);
    beforeEach(() => {
      S3.prototype.headObject = jest.fn().mockResolvedValue({ ContentLength: dataBuffer.length });
      S3.prototype.send = getObjectMock(dataBuffer);
    });
    it('should correctly return the lines if the delimiter is set', async () => {
      const reader = new S3LineReader('some-bucket', 'some-key');
      const lines = reader.getLines('\r\n');
      let line = await lines.next();
      expect(line.done).toBe(false);
      expect(line.value).toEqual('This is the first line');
      line = await lines.next();
      expect(line.done).toBe(true);
      expect(line.value).toEqual('This is the second line');
    });
    it('should correctly return lines when newline characters falls over two requests', async () => {
      const reader = new S3LineReader('some-bucket', 'some-key', 22);
      const lines = reader.getLines('\r\n');
      let line = await lines.next();
      expect(line.value).toEqual('This is the first line');
      expect(line.done).toBe(false);
      line = await lines.next();
      expect(line.value).toEqual('This is the second line');
      expect(line.done).toBe(true);
    });
  });
});

const getObjectMock = (data: Buffer) =>
  jest.fn().mockImplementation((command) => {
    if (!(command instanceof GetObjectCommand)) fail('mock not implemented for S3.prototype.send');
    const objCommand = command as GetObjectCommand;
    const range = objCommand.input.Range;
    if (!range || !range.includes('=') || !range.includes('-')) fail('Range not provided to GetObjectCommandInput');
    const [start, end] = range!.split('=')[1].split('-');
    const bytes = data.subarray(+start, +end + 1);
    return {
      Body: Readable.from(bytes),
    };
  });
