export const UPLOAD_BASE_URL = `${process.env.PUBLIC_API_URL}/${process.env.UPLOAD_DIR}`;

export const withPhotoUrl = (row) => ({
  ...row,
  url: `${UPLOAD_BASE_URL}/${row.photo_filename}`,
});