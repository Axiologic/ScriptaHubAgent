export const artworkFields = {cover:'coverUrl', thumbnail:'thumbnailUrl'};
export const artworkPath = value => typeof value === 'string'
  && /\.(?:svg|webp|png|jpe?g)$/i.test(value)
  && value.split('/').every(part => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part));

export function artworkRequirement(task) {
  return {
    required: ['generate','upload'].includes(task.values?.coverMode),
    sourceHash: task.files?.find(file => file.role === 'cover')?.sha256
  };
}
