import { AppError, ErrorCode } from '@tactia/shared';
import { createApiHandler } from './api';

export const administrativeRegistrationOnly = createApiHandler({ auth: 'none' }, () => {
  throw new AppError(
    ErrorCode.AUTHORIZATION_ERROR,
    'O cadastro de empresas e acessos é realizado pela equipe Tactia.',
  );
});
