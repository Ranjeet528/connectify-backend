
const cloudinary = require("../config/cloudinary");
const { Readable } = require("stream");
const path = require("path");

const uploadMedia = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please select a file",
      });
    }

    const file = req.file;

    // Select Cloudinary resource type based on file MIME type
    let resourceType = "raw";

    if (file.mimetype.startsWith("image/")) {
      resourceType = "image";
    } else if (
      file.mimetype.startsWith("video/") ||
      file.mimetype.startsWith("audio/")
    ) {
      resourceType = "video";
    }

    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: "connectify",
          resource_type: resourceType,
          use_filename: true,
          unique_filename: true,
          filename_override: file.originalname,
        },
        (error, result) => {
          if (error) {
            reject(error);
          } else {
            resolve(result);
          }
        }
      );

      Readable.from(file.buffer).pipe(uploadStream);
    });

    const extension = path.extname(file.originalname);

    return res.status(200).json({
      success: true,
      message: "Media uploaded successfully",

      data: {
        url: result.secure_url,
        publicId: result.public_id,
        resourceType: result.resource_type,
        format: result.format,

        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        extension,

        bytes: result.bytes,
      },
    });
  } catch (error) {
    console.error("Cloudinary upload error:", error);

    return res.status(500).json({
      success: false,
      message: "Media upload failed",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
};

module.exports = { uploadMedia };
