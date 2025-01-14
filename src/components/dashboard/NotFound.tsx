import React from 'react';

export function NotFoundPage() {
  return (
    <div style={{ textAlign: 'center', marginTop: '50px' }}>
      <h1>404 - Page Not Found</h1>
      <p>Oops! This page does not. exist.</p>
      <a href="/">Go to Homepage</a>
    </div>
  );
}