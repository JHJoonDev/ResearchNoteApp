import { createContext } from 'react';

const AiStatusContext = createContext({ enabled: false, features: [] });

export default AiStatusContext;
