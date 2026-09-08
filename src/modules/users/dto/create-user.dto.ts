import { IsEmail, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsEmail()
  email!: string;

  /** Identificador do usuário no Cognito (`sub` do token) */
  @IsString()
  cognitoSub!: string;
}
