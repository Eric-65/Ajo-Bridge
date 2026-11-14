import { Navigate, useParams } from 'react-router';

/** Short invite link /c/:id → the circle page, scrolled to the slot picker. */
export function ShareRedirect() {
  const { id } = useParams();
  return <Navigate to={`/circle/${encodeURIComponent(id)}#slots`} replace />;
}
