import { Navigate, useParams } from 'react-router';

import { captureRef } from '../lib/community.js';

/** /r/<code>: remember who invited this visitor, then open the sign-up page. */
export function RefRedirect() {
  const { code } = useParams();
  const saved = captureRef(code);
  return <Navigate to={saved ? `/signin?ref=${saved}` : '/signin'} replace />;
}
