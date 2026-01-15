import multer from "multer";
import path from "path";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

const s3Client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const storage = multer.memoryStorage();

const sanitize = (name) => {
  return name.replace(/[^a-zA-Z0-9æøåÆØÅ._-]/g, "_");
};

const imageFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const isImage =
    allowedTypes.test(path.extname(file.originalname).toLowerCase()) &&
    allowedTypes.test(file.mimetype);

  if (isImage) return cb(null, true);
  cb(new Error("Only image files are allowed"));
};

export const wishlistUpload = multer({
  storage: storage,
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

export const uploadToR2 = async (file, customFilename) => {
  const ext = path.extname(file.originalname);
  const name = customFilename
    ? sanitize(customFilename.toLowerCase()) + ext
    : sanitize(file.originalname.toLowerCase());

  const key = `${name}`;

  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
      })
    );
    const error = new Error(`DUPLICATE_FILE: '${name}' already exists`);
    error.code = "DUPLICATE_FILE";
    throw error;
  } catch (err) {
    if (err.name !== "NotFound") {
      throw err;
    }
  }

  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  });

  await s3Client.send(command);

  return {
    key: key,
    url: `${process.env.R2_PUBLIC_URL}/${key}`,
  };
};

export const deleteFromR2 = async (key) => {
  if (!key) return;
  const command = new DeleteObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
  });

  await s3Client.send(command);
};

export const deleteManyFromR2 = async (keys) => {
  if (!keys || keys.length === 0) return;
  const command = new DeleteObjectsCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Delete: {
      Objects: keys.map((key) => ({ Key: key })),
    },
  });
  await s3Client.send(command);
};

export const createFullImageUrl = (image_path, image_type) => {
  let path = image_path;
  if (image_type === "r2") {
    path = `${process.env.R2_PUBLIC_URL}/${image_path}`;
  }
  return path;
};

export const listAllImages = async () => {
  const command = new ListObjectsV2Command({
    Bucket: process.env.R2_BUCKET_NAME,
    Prefix: "",
  });

  const { Contents } = await s3Client.send(command);

  if (!Contents) return [];

  return Contents.map((file) => ({
    key: file.Key,
    url: `${process.env.R2_PUBLIC_URL}/${file.Key}`,
    size: file.Size,
    lastModified: file.LastModified,
  }));
};
