export default function TeamLogo({ teamId, size = 48 }) {
  const src = teamId === 'teamA' ? '/nw-logo.png' : '/ne-logo.png';
  const alt = teamId === 'teamA' ? 'Northwestern' : 'Nebraska';
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      style={{ objectFit: 'contain', display: 'block' }}
    />
  );
}
