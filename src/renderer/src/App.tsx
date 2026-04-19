import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';

export function App() {
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
    };
    document.addEventListener('dragover', onDragOver);
    return () => {
      document.removeEventListener('dragover', onDragOver);
    };
  }, []);

  return <RouterProvider router={router} />;
}
