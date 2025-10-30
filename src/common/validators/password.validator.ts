import { ValidateBy } from 'class-validator';

export function IsStrongPassword() {
  return ValidateBy({
    name: 'isStrongPassword',
    validator: {
      validate: (value: string) => {
        const strongRegex =
          /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#\\$%\\^&\\*])/;
        return (
          typeof value === 'string' &&
          value.length >= 8 &&
          strongRegex.test(value)
        );
      },
      defaultMessage: () =>
        'Password must contain uppercase, lowercase, number and special character',
    },
  });
}
