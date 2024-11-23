import { Client } from 'minio';
import Run from '../models/Run';

const minioClient = new Client({
  endPoint: process.env.MINIO_ENDPOINT ? process.env.MINIO_ENDPOINT : 'localhost',
  port: parseInt(process.env.MINIO_PORT || '9000'),
  useSSL: false,
  accessKey: process.env.MINIO_ACCESS_KEY || 'minio-access-key',
  secretKey: process.env.MINIO_SECRET_KEY || 'minio-secret-key',
});

minioClient.bucketExists('maxun-test')
  .then((exists) => {
    if (exists) {
      console.log('MinIO connected successfully.');
    } else {
      console.log('MinIO connected successfully.');
    }
  })
  .catch((err) => {
    console.error('Error connecting to MinIO:', err);
  })

async function createBucketWithPolicy(bucketName: string, policy = 'public-read') {
  try {
    const bucketExists = await minioClient.bucketExists(bucketName);
    if (!bucketExists) {
      await minioClient.makeBucket(bucketName);
      console.log(`Bucket ${bucketName} created successfully.`);
    } else {
      console.log(`Bucket ${bucketName} already exists.`);
    }

    if (policy === 'public-read') {
      // Apply public-read policy after confirming the bucket exists
      const policyJSON = {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: "*",
            Action: ["s3:GetObject"],
            Resource: [`arn:aws:s3:::${bucketName}/*`]
          }
        ]
      };
      await minioClient.setBucketPolicy(bucketName, JSON.stringify(policyJSON));
      console.log(`Public-read policy applied to bucket ${bucketName}.`);
    }
  } catch (error) {
    console.error('Error in bucket creation or policy application:', error);
  }
}



class BinaryOutputService {
  private bucketName: string;

  constructor(bucketName: string) {
    this.bucketName = bucketName;
  }

  /**
   * Uploads binary data to Minio and stores references in PostgreSQL.
   * @param run - The run object representing the current process.
   * @param binaryOutput - The binary output object containing data to upload.
   * @returns A map of Minio URLs pointing to the uploaded binary data.
   */
  async uploadAndStoreBinaryOutput(run: Run, binaryOutput: Record<string, any>): Promise<Record<string, string>> {
    const uploadedBinaryOutput: Record<string, string> = {};
    const plainRun = run.toJSON();

    for (const key of Object.keys(binaryOutput)) {
      let binaryData = binaryOutput[key];

      if (!plainRun.runId) {
        console.error('Run ID is undefined. Cannot upload binary data.');
        continue;
      }

      console.log(`Processing binary output key: ${key}`);

      // Check if binaryData has a valid Buffer structure and parse it
      if (binaryData && typeof binaryData.data === 'string') {
        try {
          const parsedData = JSON.parse(binaryData.data);
          if (parsedData && parsedData.type === 'Buffer' && Array.isArray(parsedData.data)) {
            binaryData = Buffer.from(parsedData.data);
          } else {
            console.error(`Invalid Buffer format for key: ${key}`);
            continue;
          }
        } catch (error) {
          console.error(`Failed to parse JSON for key: ${key}`, error);
          continue;
        }
      }

      // Handle cases where binaryData might not be a Buffer
      if (!Buffer.isBuffer(binaryData)) {
        console.error(`Binary data for key ${key} is not a valid Buffer.`);
        continue;
      }

      try {
        const minioKey = `${plainRun.runId}/${key}`;

        await this.uploadBinaryOutputToMinioBucket(run, minioKey, binaryData);

        // Construct the public URL for the uploaded object
        // todo: use minio endpoint 
        const publicUrl = `http://localhost:${process.env.MINIO_PORT}/${this.bucketName}/${minioKey}`;

        // Save the public URL in the result object
        uploadedBinaryOutput[key] = publicUrl;
      } catch (error) {
        console.error(`Error uploading key ${key} to MinIO:`, error);
      }
    }

    console.log('Uploaded Binary Output:', uploadedBinaryOutput);

    try {
      await run.update({ binaryOutput: uploadedBinaryOutput });
      console.log('Run successfully updated with binary output');
    } catch (updateError) {
      console.error('Error updating run with binary output:', updateError);
    }

    return uploadedBinaryOutput;
  }

  async uploadBinaryOutputToMinioBucket(run: Run, key: string, data: Buffer): Promise<void> {
    await createBucketWithPolicy('maxun-run-screenshots', 'public-read');
    const bucketName = 'maxun-run-screenshots';
    try {
      console.log(`Uploading to bucket ${bucketName} with key ${key}`);
      await minioClient.putObject(bucketName, key, data, data.length, { 'Content-Type': 'image/png' });
      const plainRun = run.toJSON();
      plainRun.binaryOutput[key] = `minio://${bucketName}/${key}`;
      console.log(`Successfully uploaded to MinIO: minio://${bucketName}/${key}`);
    } catch (error) {
      console.error(`Error uploading to MinIO bucket: ${bucketName} with key: ${key}`, error);
      throw error;
    }
  }

  public async getBinaryOutputFromMinioBucket(key: string): Promise<Buffer> {
    const bucketName = 'maxun-run-screenshots';

    try {
      console.log(`Fetching from bucket ${bucketName} with key ${key}`);
      const stream = await minioClient.getObject(bucketName, key);
      return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', (error) => {
          console.error('Error while reading the stream from MinIO:', error);
          reject(error);
        });
      });
    } catch (error) {
      console.error(`Error fetching from MinIO bucket: ${bucketName} with key: ${key}`, error);
      throw error;
    }
  }
}

export { minioClient, BinaryOutputService };